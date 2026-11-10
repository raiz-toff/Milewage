package app.milewage.core.sync

import app.milewage.core.api.Api
import app.milewage.core.api.ApiClient
import app.milewage.core.api.ApiException
import app.milewage.core.api.ApiJson
import app.milewage.core.api.ChangeEntity
import app.milewage.core.api.ChangeEntry
import app.milewage.core.api.ChangeType
import app.milewage.core.api.OdometerReading
import app.milewage.core.api.Settings
import app.milewage.core.api.Shift
import app.milewage.core.api.SyncChanges
import app.milewage.core.api.Trip
import app.milewage.core.api.TripKind
import app.milewage.core.api.Vehicle
import app.milewage.core.pairing.DeviceClient
import app.milewage.core.pairing.DeviceSession
import app.milewage.core.ports.Clock
import app.milewage.core.shift.CalcSource
import app.milewage.core.shift.LocalStore
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.OdometerRecord
import app.milewage.core.shift.OverwriteEntry
import app.milewage.core.shift.OverwriteReason
import app.milewage.core.shift.ReconStatus
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ServerFlag
import app.milewage.core.shift.ShiftStatus
import app.milewage.core.shift.TripRecord
import app.milewage.core.shift.TripSource
import app.milewage.core.shift.VehicleRecord
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull

enum class PullState { OK, OFFLINE, HALTED, DISABLED, NOT_PAIRED, SKIPPED }

data class PullResult(val state: PullState, val applied: Int, val overwrites: Int = 0, val fullWindow: Boolean = false)

/**
 * `GET /sync/changes` into the phone's database (15 sections 6.5, 7, 8), a port of the Expo app's
 * `sync/pull.ts`: the server's recalculations, edits made on the web, shifts imported or recorded
 * elsewhere, vehicles and settings. The server's rows win, except a phone edit strictly newer than
 * the server's (it is still going up); every value the phone loses goes to the overwrite log first,
 * and a shift whose create or end only the phone holds is not overwritten by the feed.
 */
class ChangePuller(
    private val store: LocalStore,
    private val outbox: Outbox,
    private val session: suspend () -> DeviceClient?,
    private val device: DeviceSession,
    /** The server's settings arrived through the feed (`Pairing.storeSettings`). */
    private val onSettings: suspend (Settings) -> Unit,
    private val clock: Clock,
    /** Pulls closer together than this are skipped unless forced (15 section 6.5: 5 minutes). */
    private val minIntervalMs: Long = 300_000,
) {
    private val busy = Mutex()
    private var last = Long.MIN_VALUE / 2
    private var overwrites = 0

    suspend fun pull(force: Boolean = false): PullResult {
        if (!busy.tryLock()) return PullResult(PullState.SKIPPED, 0)
        try {
            if (!force && clock.nowMs() - last < minIntervalMs) return PullResult(PullState.SKIPPED, 0)
            val s = session() ?: return PullResult(PullState.NOT_PAIRED, 0)
            if (!s.flags.sync) return PullResult(PullState.DISABLED, 0)
            if (device.halted() != null) return PullResult(PullState.HALTED, 0)
            return run(s.client)
        } finally {
            busy.unlock()
        }
    }

    private suspend fun run(client: ApiClient): PullResult {
        var applied = 0
        var expired = false
        overwrites = 0
        while (true) {
            val after = store.get(CURSOR)?.toLongOrNull() ?: 0
            val page = try {
                client.call(Api.pullChanges, query = listOf("after" to after.toString(), "limit" to PAGE.toString())).data
            } catch (e: ApiException) {
                if (e.status == 410 && !expired) {
                    // The server pruned its log (or was restored): read the whole window again, by key.
                    expired = true
                    store.put(CURSOR, "0")
                    continue
                }
                return PullResult(if (device.halted() != null) PullState.HALTED else PullState.OFFLINE, applied, overwrites, expired)
            }
            applyPage(page)
            applied += page.changes.size
            for (c in page.changes) {
                if (c.entity == ChangeEntity.SETTINGS && c.op == "upsert" && c.data != null) {
                    decode(Settings.serializer(), c.data)?.let { onSettings(it) }
                }
            }
            if (!page.hasMore) break
        }
        last = clock.nowMs()
        store.put(LAST_PULL, last.toString())
        return PullResult(PullState.OK, applied, overwrites, expired)
    }

    private suspend fun applyPage(page: SyncChanges) = store.transaction {
        for (c in page.changes) apply(c)
        store.put(CURSOR, page.nextCursor.toString())
    }

    private suspend fun apply(c: ChangeEntry) {
        val data = c.data
        when (c.entity) {
            ChangeEntity.SHIFT -> if (c.op == "delete") deleteShift(c.key) else data?.let { d -> decode(Shift.serializer(), d)?.let { upsertShift(it) } }
            ChangeEntity.TRIP -> if (c.op == "delete") deleteTrip(c.key) else data?.let { d -> decode(Trip.serializer(), d)?.let { upsertTrip(it) } }
            ChangeEntity.OVERRIDE -> override(c)
            ChangeEntity.ODOMETER ->
                if (c.op == "delete") {
                    c.key.toLongOrNull()?.let { deleteOdometer(it) }
                } else {
                    data?.let { d -> decode(OdometerReading.serializer(), d)?.let { upsertOdometer(it) } }
                }
            ChangeEntity.VEHICLE ->
                if (c.op == "delete") {
                    c.key.toLongOrNull()?.let { store.deleteVehicle(it) }
                } else {
                    data?.let { d -> decode(Vehicle.serializer(), d)?.let { store.upsertVehicle(vehicleOf(it)) } }
                }
            else -> Unit // settings go to onSettings after the page is stored; unknown entities are skipped
        }
    }

    private suspend fun log(entity: String, key: String, reason: OverwriteReason, local: JsonElement, server: JsonElement?) {
        overwrites++
        store.addOverwrite(OverwriteEntry(0, clock.nowMs(), entity, key, reason, local.toString(), server?.toString()))
    }

    private suspend fun unsent(kind: ChangeType, shift: String, match: (OutboxItem) -> Boolean = { true }) =
        outbox.pending().filter { it.kind == kind && it.shiftClientId == shift && match(it) }

    private suspend fun dropItems(items: List<OutboxItem>) {
        for (i in items) store.deleteChange(i.id)
    }

    private fun stamp(i: OutboxItem, field: String): Long = (i.body[field] as? JsonPrimitive)?.longOrNull ?: 0

    private suspend fun upsertShift(s: Shift) {
        val local = store.shift(s.clientId)
        if (local == null) {
            store.upsertShift(ServerAnswers.recordOf(s, clock.nowMs()))
            return
        }
        // The phone is still the only holder of this shift's create or end: its own queue decides, not the feed.
        if (outbox.has(ChangeType.SHIFT_CREATE, s.clientId) || outbox.has(ChangeType.SHIFT_END, s.clientId) || local.running) {
            store.upsertShift(local.copy(serverId = s.id))
            return
        }
        var notes = s.notes
        var vehicle = s.vehicleId
        var updatedAt = s.updatedAt ?: local.updatedAt
        val patches = unsent(ChangeType.SHIFT_PATCH, s.clientId)
        if (patches.isNotEmpty()) {
            val mine = patches.maxOf { stamp(it, "updated_at") }
            if (mine > (s.updatedAt ?: 0)) {
                // The phone's edit is strictly newer: it keeps its value and wins when it is sent.
                notes = local.notes
                vehicle = local.vehicleId
                updatedAt = local.updatedAt
            } else {
                log(
                    "shift", s.clientId, OverwriteReason.SUPERSEDED_BY_SERVER,
                    buildJsonObject { put("patches", JsonArray(patches.map { it.body })) },
                    buildJsonObject {
                        put("notes", s.notes?.let(::JsonPrimitive) ?: JsonNull)
                        put("vehicle_id", JsonPrimitive(s.vehicleId))
                    },
                )
                dropItems(patches)
            }
        }
        val serverTotals = ServerAnswers.serverDistances(s, local.distances)
        val localTotal = local.distances?.totalM
        if (localTotal != null && s.totalM != null && localTotal != s.totalM) {
            log(
                "shift", s.clientId, OverwriteReason.RECON_DIFF,
                ServerAnswers.totalsJson(local.distances, local.calcVersion, null),
                ServerAnswers.totalsJson(serverTotals, s.calcVersion, s.reconReasons),
            )
        }
        store.upsertShift(
            local.copy(
                serverId = s.id,
                vehicleId = vehicle,
                status = ShiftStatus.of(s.status.wireName()),
                endedAt = s.endedAt,
                localDate = s.localDate,
                distances = serverTotals,
                calcVersion = s.calcVersion ?: local.calcVersion,
                calcSource = CalcSource.SERVER,
                serverTotalM = s.totalM,
                recon = ReconStatus.of(s.reconStatus),
                reconReasons = s.reconReasons,
                serverFlags = s.flags.map { ServerFlag(it.code, it.severity) },
                notes = notes,
                updatedAt = updatedAt,
                serverDeductionCents = s.deductionCents,
                serverDeductionKnown = true,
                sendState = if (local.sendState == SendState.NEEDS_ATTENTION) local.sendState else SendState.SENT,
            ),
        )
    }

    /** A shift deleted on the web: the server's delete wins; unsent edits go to the overwrite log first. */
    private suspend fun deleteShift(clientId: String) {
        store.shift(clientId) ?: return
        val queued = outbox.pending().filter { it.shiftClientId == clientId }
        if (queued.isNotEmpty()) {
            log(
                "shift", clientId, OverwriteReason.DELETED_ON_SERVER,
                buildJsonObject { put("queued", JsonArray(queued.map { q -> JsonArray(listOf(JsonPrimitive(q.kind.wire), q.body)) })) },
                null,
            )
        }
        outbox.dropShift(clientId)
        store.deleteShift(clientId)
    }

    private suspend fun tripShift(t: Trip): String? {
        val key = t.tripKey
        if (key != null && ':' in key) return key.substringBefore(':')
        return store.shiftByServerId(t.shiftId)?.clientId
    }

    private suspend fun upsertTrip(t: Trip) {
        val shift = tripShift(t) ?: return
        val key = t.tripKey ?: return
        store.shift(shift) ?: return
        val manual = t.source == "manual"
        // A manual trip's key on the wire is `<shift>:<uuid>`; on the phone it is the uuid.
        val localKey = if (manual && key.startsWith("$shift:")) key.removePrefix("$shift:") else key
        val pending = unsent(if (manual) ChangeType.TRIP_MANUAL else ChangeType.TRIP_OVERRIDE, shift) {
            if (manual) it.entityKey == "$shift:$localKey" else it.entityKey == key
        }
        if (pending.isNotEmpty()) {
            val mine = pending.maxOf { stamp(it, "edited_at") }
            if (mine > (t.editedAt ?: 0)) return // the phone's edit is strictly newer and still going up
            log(
                "trip", key, OverwriteReason.SUPERSEDED_BY_SERVER,
                buildJsonObject { put("pending", JsonArray(pending.map { it.body })) },
                buildJsonObject {
                    put("kind", JsonPrimitive(t.kind.wire()))
                    put("purpose", JsonPrimitive(t.purpose))
                    put("edited_at", t.editedAt?.let(::JsonPrimitive) ?: JsonNull)
                },
            )
            dropItems(pending)
        }
        store.upsertTrip(
            TripRecord(
                tripKey = localKey,
                shiftClientId = shift,
                serverId = t.id,
                kind = t.kind,
                originalKind = t.originalKind ?: t.kind,
                source = if (manual) TripSource.MANUAL else TripSource.AUTO,
                startedAt = t.startedAt,
                endedAt = t.endedAt,
                startLatE7 = t.startLatE7,
                startLonE7 = t.startLonE7,
                endLatE7 = t.endLatE7,
                endLonE7 = t.endLonE7,
                distanceM = t.distanceM,
                purpose = t.purpose,
                editedAt = t.editedAt,
                sendState = SendState.SENT,
            ),
        )
    }

    private suspend fun deleteTrip(key: String) {
        val local = store.trip(key) ?: store.trip(key.substringAfter(':')) ?: return
        val pending = outbox.pending().filter { it.entityKey == key || it.entityKey == "${local.shiftClientId}:${local.tripKey}" }
        if (pending.isNotEmpty()) {
            log("trip", key, OverwriteReason.DELETED_ON_SERVER, buildJsonObject { put("pending", JsonArray(pending.map { it.body })) }, null)
            dropItems(pending)
        }
        store.deleteTrip(local.tripKey)
    }

    /** A driver edit the server holds. An orphan (no trip carries its key any more) is reported, never dropped. */
    private suspend fun override(c: ChangeEntry) {
        if (c.op != "orphaned_override" || c.data == null) return
        val trip = store.trip(c.key)
        val local = trip?.let {
            buildJsonObject {
                put("trip_key", JsonPrimitive(it.tripKey))
                put("kind", JsonPrimitive(it.kind.wire()))
                put("purpose", JsonPrimitive(it.purpose))
            }
        } ?: buildJsonObject { put("trip_key", JsonPrimitive(c.key)) }
        log("trip", c.key, OverwriteReason.SUPERSEDED_BY_SERVER, local, JsonObject(c.data + ("orphaned" to JsonPrimitive(true))))
    }

    private suspend fun upsertOdometer(r: OdometerReading) {
        val shiftId = r.shiftId ?: return
        val kind = OdometerKind.of(r.kind) ?: return
        val shift = store.shiftByServerId(shiftId)?.clientId ?: return
        val pending = unsent(ChangeType.ODOMETER_PUT, shift) { it.entityKey == "$shift:${kind.wire}" }
        if (pending.isNotEmpty()) {
            val mine = pending.maxOf { stamp(it, "recorded_at") }
            if (mine > r.recordedAt) return
            log(
                "odometer", "$shift:${kind.wire}", OverwriteReason.SUPERSEDED_BY_SERVER,
                buildJsonObject { put("pending", JsonArray(pending.map { it.body })) },
                buildJsonObject {
                    put("reading_m", JsonPrimitive(r.readingM))
                    put("recorded_at", JsonPrimitive(r.recordedAt))
                },
            )
            dropItems(pending)
        }
        store.upsertOdometer(OdometerRecord(shift, kind, r.readingM, r.recordedAt, r.id, SendState.SENT))
    }

    private suspend fun deleteOdometer(serverId: Long) {
        val row = store.odometerByServerId(serverId) ?: return
        val key = "${row.shiftClientId}:${row.kind.wire}"
        val pending = outbox.pending().filter { it.entityKey == key }
        if (pending.isNotEmpty()) {
            log("odometer", key, OverwriteReason.DELETED_ON_SERVER, buildJsonObject { put("pending", JsonArray(pending.map { it.body })) }, null)
            dropItems(pending)
        }
        store.deleteOdometer(row.shiftClientId, row.kind)
    }

    private fun <T> decode(serializer: KSerializer<T>, data: JsonObject): T? =
        runCatching { ApiJson.decodeFromJsonElement(serializer, data) }.getOrNull()

    companion object {
        const val CURSOR = "sync.cursor"
        const val LAST_PULL = "sync.lastPullAt"
        private const val PAGE = 200

        fun vehicleOf(v: Vehicle) = VehicleRecord(v.id, v.name, v.kind, v.plate, v.archivedAt)
    }
}

internal fun TripKind.wire(): String = when (this) {
    TripKind.ACTIVE -> "active"
    TripKind.DEADHEAD -> "deadhead"
    TripKind.PERSONAL -> "personal"
}
