package app.milewage.data.db

import androidx.room3.withWriteTransaction
import app.milewage.core.api.ApiJson
import app.milewage.core.api.ChangeType
import app.milewage.core.api.DiagEventIn
import app.milewage.core.api.PointManifest
import app.milewage.core.api.Segmenter
import app.milewage.core.api.TripKind
import app.milewage.core.shift.BatteryReading
import app.milewage.core.shift.CalcSource
import app.milewage.core.shift.Distances
import app.milewage.core.shift.LocalStore
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.OdometerRecord
import app.milewage.core.shift.OverwriteEntry
import app.milewage.core.shift.OverwriteReason
import app.milewage.core.shift.ReconStatus
import app.milewage.core.shift.RoutePoint
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ServerFlag
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.ShiftStatus
import app.milewage.core.shift.StopRecord
import app.milewage.core.shift.TripRecord
import app.milewage.core.shift.TripSource
import app.milewage.core.shift.VehicleRecord
import app.milewage.core.sync.OutboxCounts
import app.milewage.core.sync.OutboxItem
import app.milewage.core.sync.ResendMark
import app.milewage.core.tracking.FixStore
import app.milewage.core.tracking.Interruption
import app.milewage.core.tracking.InterruptionLog
import app.milewage.core.tracking.InterruptionReason
import app.milewage.core.tracking.RecordedFix
import app.milewage.engine.Flag
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * [LocalStore] on the Room database: the one place that maps rows to the core's records. Every
 * method commits before it returns (Room runs each statement in a transaction; [transaction] groups
 * several). Also the tracker's [FixStore] and an [InterruptionLog].
 */
class RoomLocalStore(private val db: MileWageDatabase) : LocalStore {
    private val dao = db.dao()

    override suspend fun <T> transaction(block: suspend () -> T): T = db.withWriteTransaction { block() }

    // Shifts ----------------------------------------------------------------------------------

    override suspend fun shift(clientId: String) = dao.shift(clientId)?.toRecord()

    override suspend fun shiftByServerId(serverId: Long) = dao.shiftByServerId(serverId)?.toRecord()

    override suspend fun shiftByServerId(serverId: Long, instanceId: String?) = dao.shiftByServerIdOn(serverId, instanceId)?.toRecord()

    override suspend fun runningShift() = dao.runningShift()?.toRecord()

    override suspend fun shifts(limit: Int) = dao.shifts(limit).map { it.toRecord() }

    override suspend fun unsentShifts() = dao.unsentShifts().map { it.toRecord() }

    override suspend fun shiftsFrom(fromDate: String) = dao.shiftsFrom(fromDate).map { it.toRecord() }

    override suspend fun upsertShift(shift: ShiftRecord) = dao.upsertShift(shift.toEntity())

    override suspend fun shiftIdsNotBoundTo(instanceId: String?) = dao.shiftIdsNotBoundTo(instanceId).toHashSet()

    override suspend fun bindUnbound(instanceId: String) = dao.bindUnbound(instanceId)

    override suspend fun deleteShift(clientId: String) = transaction {
        dao.deleteShift(clientId) // trips, stops, route and readings cascade
        dao.deleteFixes(clientId)
        dao.deleteInterruptions(clientId)
        dao.deleteResend(clientId)
    }

    override suspend fun trips(clientId: String) = dao.trips(clientId).map { it.toRecord() }

    override suspend fun trip(tripKey: String) = dao.trip(tripKey)?.toRecord()

    override suspend fun upsertTrip(trip: TripRecord) = dao.upsertTrip(trip.toEntity())

    override suspend fun deleteTrip(tripKey: String) = dao.deleteTrip(tripKey)

    override suspend fun stops(clientId: String) = dao.stops(clientId).map {
        StopRecord(it.stopKey, it.shiftClientId, it.startedAt, it.endedAt, it.dwellS, it.latE7, it.lonE7, it.confidence, it.estRole, it.role)
    }

    override suspend fun route(clientId: String): List<RoutePoint> =
        dao.route(clientId)?.let { r -> JSON.decodeFromString(ROUTE, r.pointsJson).map { RoutePoint(it[0], it[1], it[2]) } } ?: emptyList()

    override suspend fun replaceResult(clientId: String, trips: List<TripRecord>, stops: List<StopRecord>, route: List<RoutePoint>) = transaction {
        dao.deleteAutoTrips(clientId)
        dao.upsertTrips(trips.map { it.toEntity() })
        dao.deleteStops(clientId)
        dao.insertStops(stops.map { StopEntity(it.stopKey, clientId, it.startedAt, it.endedAt, it.dwellS, it.latE7, it.lonE7, it.confidence, it.estRole, it.role) })
        if (route.size >= 2) {
            dao.upsertRoute(RouteEntity(clientId, JSON.encodeToString(ROUTE, route.map { listOf(it.latE7, it.lonE7, it.t) })))
        } else {
            dao.deleteRoute(clientId)
        }
    }

    override suspend fun interruptions(clientId: String) = dao.interruptions(clientId).map { it.toInterruption() }

    override suspend fun replaceInterruptions(clientId: String, list: List<Interruption>) = transaction {
        dao.deleteInterruptions(clientId)
        dao.insertInterruptions(list.map { InterruptionEntity(0, clientId, it.fromMs, it.toMs, it.reason.name) })
    }

    override suspend fun odometer(clientId: String) = dao.odometer(clientId).mapNotNull { it.toRecord() }

    override suspend fun odometerByServerId(serverId: Long) = dao.odometerByServerId(serverId)?.toRecord()

    override suspend fun odometerByServerId(serverId: Long, instanceId: String?) = dao.odometerByServerIdOn(serverId, instanceId)?.toRecord()

    override suspend fun upsertOdometer(reading: OdometerRecord) = dao.upsertOdometer(
        OdometerEntity(reading.shiftClientId, reading.kind.wire, reading.readingM, reading.recordedAt, reading.serverId, reading.sendState.wire),
    )

    override suspend fun deleteOdometer(clientId: String, kind: OdometerKind) = dao.deleteOdometer(clientId, kind.wire)

    override suspend fun lastOdometerAt(vehicleId: Long) = dao.lastOdometerAt(vehicleId)

    override suspend fun vehicles() = dao.vehicles().map { VehicleRecord(it.id, it.name, it.kind, it.plate, it.archivedAt) }

    override suspend fun upsertVehicle(vehicle: VehicleRecord) =
        dao.upsertVehicle(VehicleEntity(vehicle.id, vehicle.name, vehicle.kind, vehicle.plate, vehicle.archivedAt))

    override suspend fun deleteVehicle(id: Long) = dao.deleteVehicle(id)

    override suspend fun addOverwrite(entry: OverwriteEntry) = dao.insertOverwrite(
        OverwriteEntity(0, entry.at, entry.entity, entry.entityKey, entry.reason.wire, entry.localJson, entry.serverJson, entry.seen),
    )

    override suspend fun overwrites(clientId: String) = dao.overwrites(clientId, "$clientId:%").map {
        OverwriteEntry(it.id, it.at, it.entity, it.entityKey, OverwriteReason.of(it.reason), it.localJson, it.serverJson, it.seen)
    }

    override suspend fun markOverwriteSeen(id: Long) = dao.markOverwriteSeen(id)

    // Fixes -----------------------------------------------------------------------------------

    override suspend fun shiftsWithPending() = dao.shiftsWithPending()

    override suspend fun pending(shiftClientId: String, limit: Int) = dao.pending(shiftClientId, limit).map { it.toFix() }

    override suspend fun pendingCount(shiftClientId: String?) =
        if (shiftClientId == null) dao.pendingCountAll() else dao.pendingCount(shiftClientId)

    override suspend fun oldestPendingAt() = dao.oldestPendingAt()

    /** Fixes the server refused for good, kept on the phone (`storage.state`'s `quarantine_rows`). */
    suspend fun setAsideCount(): Long = dao.setAsideCount()

    override suspend fun markSent(seqs: List<Long>, at: Long) = chunked(seqs) { dao.markSent(it, at) }

    override suspend fun setAside(seqs: List<Long>, reason: String, at: Long) = chunked(seqs) { dao.setAside(it, reason, at) }

    override suspend fun after(shiftClientId: String, afterSeq: Long, limit: Int) = dao.after(shiftClientId, afterSeq, limit).map { it.toFix() }

    override suspend fun manifest(shiftClientId: String): PointManifest? {
        val m = dao.manifest(shiftClientId)
        return if (m.n == 0L || m.first == null || m.last == null) null else PointManifest(m.first, m.last, m.n)
    }

    override suspend fun evictSent(sentBefore: Long) = dao.evictSent(sentBefore)

    private suspend fun chunked(seqs: List<Long>, run: suspend (List<Long>) -> Int): Int {
        if (seqs.isEmpty()) return 0
        return transaction { seqs.chunked(500).sumOf { run(it) } }
    }

    /**
     * The tracker's points table. [FixStore.append] writes one batch in one transaction (a delivery
     * of 1 to 3 fixes every 5 to 15 s while moving, one a minute when still) and returns the fixes
     * with their AUTOINCREMENT seq.
     */
    override val fixes: FixStore = object : FixStore {
        override suspend fun append(shiftClientId: String, fixes: List<RecordedFix>): List<RecordedFix> {
            if (fixes.isEmpty()) return emptyList()
            val ids = dao.insertFixes(fixes.map { it.toEntity(shiftClientId) })
            return fixes.mapIndexed { i, f -> f.copy(seq = ids[i], shiftClientId = shiftClientId) }
        }

        override suspend fun fixesFor(shiftClientId: String) = dao.fixesFor(shiftClientId).map { it.toFix() }

        override suspend fun lastSeq(shiftClientId: String) = dao.lastSeq(shiftClientId)
    }

    /** Interruptions kept in the database with their shift (an alternative to the tracker's preferences store). */
    val interruptionLog: InterruptionLog = object : InterruptionLog {
        override suspend fun record(shiftClientId: String, interruption: Interruption) =
            dao.insertInterruption(InterruptionEntity(0, shiftClientId, interruption.fromMs, interruption.toMs, interruption.reason.name))

        override suspend fun list(shiftClientId: String) = interruptions(shiftClientId)

        override suspend fun clear(shiftClientId: String) = dao.deleteInterruptions(shiftClientId)
    }

    // Outbox ----------------------------------------------------------------------------------

    override suspend fun insertChange(kind: ChangeType, entityKey: String, body: JsonObject, createdAt: Long): Long =
        dao.insertChange(OutboxEntity(0, kind.wire, entityKey, entityKey.substringBefore(':'), body.toString(), createdAt))

    override suspend fun replaceChange(id: Long, body: JsonObject) = dao.replaceChange(id, body.toString())

    override suspend fun pendingIds(kind: ChangeType, entityKey: String) = dao.pendingIds(kind.wire, entityKey)

    override suspend fun pendingChanges() = dao.changes("pending").mapNotNull { it.toItem() }

    override suspend fun parkedChanges() = dao.changes("parked").mapNotNull { it.toItem() }

    override suspend fun changeCounts(): OutboxCounts {
        val r = dao.changeCounts()
        return OutboxCounts(r.pending ?: 0, r.parked ?: 0, r.oldestAt)
    }

    override suspend fun hasChange(kind: ChangeType, shiftClientId: String) = dao.hasChange(kind.wire, shiftClientId)

    override suspend fun hasAnyChange(shiftClientId: String) = dao.hasAnyChange(shiftClientId)

    override suspend fun deleteChange(id: Long) = dao.deleteChange(id)

    override suspend fun deleteSentChange(id: Long, body: JsonObject) = dao.deleteSentChange(id, body.toString())

    override suspend fun changeFailed(id: Long, error: String) = dao.changeFailed(id, error)

    override suspend fun parkChange(id: Long, error: String) = dao.parkChange(id, error)

    override suspend fun unparkChanges(shiftClientId: String?) = if (shiftClientId == null) dao.unparkAll() else dao.unpark(shiftClientId)

    override suspend fun dropChanges(shiftClientId: String) = dao.dropChanges(shiftClientId)

    // Resend, bookkeeping, diagnostics ---------------------------------------------------------

    override suspend fun resendMarks() = dao.resendMarks().map { it.toMark() }

    override suspend fun resendMark(shiftClientId: String) = dao.resendMark(shiftClientId)?.toMark()

    override suspend fun markForResend(shiftClientIds: List<String>, mark: (String) -> ResendMark) =
        transaction { for (m in shiftClientIds.map(mark)) dao.upsertResend(m.shiftClientId, m.gen, m.phase.wire, m.afterSeq) }

    override suspend fun swapResendMark(expected: ResendMark, next: ResendMark) = dao.swapResend(
        expected.shiftClientId, expected.gen, expected.phase.wire, expected.afterSeq, next.gen, next.phase.wire, next.afterSeq,
    ) == 1

    override suspend fun dropResendMark(expected: ResendMark) =
        dao.dropResend(expected.shiftClientId, expected.gen, expected.phase.wire, expected.afterSeq) == 1

    override suspend fun get(key: String) = dao.get(key)

    override suspend fun put(key: String, value: String) = dao.put(key, value)

    override suspend fun remove(key: String) = dao.remove(key)

    override suspend fun appendDiag(event: DiagEventIn) = dao.insertDiag(
        DiagEventEntity(0, event.kind, if (event.level == app.milewage.core.api.DiagEventLevel.VERBOSE) "verbose" else "basic", ApiJson.encodeToString(DiagEventIn.serializer(), event)),
    )

    override suspend fun oldestDiag(limit: Int) = dao.oldestDiag(limit).mapNotNull { e ->
        runCatching { e.id to ApiJson.decodeFromString(DiagEventIn.serializer(), e.json) }.getOrNull()
    }

    override suspend fun deleteDiag(ids: List<Long>) {
        if (ids.isNotEmpty()) ids.chunked(500).forEach { dao.deleteDiag(it) }
    }

    override suspend fun diagCount() = dao.diagCount()

    override suspend fun clearDiag() = dao.clearDiag()

    // Mapping ---------------------------------------------------------------------------------

    private companion object {
        val JSON = ApiJson
        val ROUTE = ListSerializer(ListSerializer(Long.serializer()))
        val FLAGS = ListSerializer(Flag.serializer())
        val STRINGS = ListSerializer(String.serializer())

        fun encodeServerFlags(flags: List<ServerFlag>): String =
            JsonArray(flags.map { JsonObject(mapOf("code" to JsonPrimitive(it.code), "severity" to JsonPrimitive(it.severity))) }).toString()

        fun decodeServerFlags(text: String): List<ServerFlag> = runCatching {
            JSON.parseToJsonElement(text).jsonArray.map { e ->
                val o = e.jsonObject
                ServerFlag(o["code"]!!.jsonPrimitive.content, o["severity"]!!.jsonPrimitive.content)
            }
        }.getOrDefault(emptyList())

        fun seg(s: Segmenter) = if (s == Segmenter.STOPS) "stops" else "whole_shift"

        fun kind(k: TripKind) = when (k) {
            TripKind.ACTIVE -> "active"
            TripKind.DEADHEAD -> "deadhead"
            TripKind.PERSONAL -> "personal"
        }

        fun kindOf(s: String) = when (s) {
            "deadhead" -> TripKind.DEADHEAD
            "personal" -> TripKind.PERSONAL
            else -> TripKind.ACTIVE
        }

        fun ShiftRecord.toEntity() = ShiftEntity(
            clientId = clientId,
            serverId = serverId,
            vehicleId = vehicleId,
            status = status.wire,
            segmenter = seg(segmenter),
            startedAt = startedAt,
            endedAt = endedAt,
            localDate = localDate,
            totalM = distances?.totalM,
            activeM = distances?.activeM,
            deadheadM = distances?.deadheadM,
            personalM = distances?.personalM,
            calcVersion = calcVersion,
            inputDigest = inputDigest,
            flagsJson = phoneFlags.takeIf { it.isNotEmpty() }?.let { JSON.encodeToString(FLAGS, it) },
            serverFlagsJson = serverFlags.takeIf { it.isNotEmpty() }?.let(::encodeServerFlags),
            calcSource = calcSource.wire,
            serverTotalM = serverTotalM,
            reconStatus = recon.wire,
            reconReasonsJson = JSON.encodeToString(STRINGS, reconReasons),
            firstSeq = manifest?.firstSeq,
            lastSeq = manifest?.lastSeq,
            pointCount = manifest?.pointCount,
            autoClosed = autoClosed,
            clockSkewMs = clockSkewMs,
            notes = notes,
            updatedAt = updatedAt,
            syncState = sendState.wire,
            serverDeductionCents = serverDeductionCents,
            serverDeductionKnown = serverDeductionKnown,
            serverHasOtherShift = serverHasOtherShift,
            batteryStartPct = batteryStart?.level,
            batteryStartCharging = batteryStart?.charging,
            batteryEndPct = batteryEnd?.level,
            batteryEndCharging = batteryEnd?.charging,
            engineMs = engineMs,
            instanceId = instanceId,
        )

        fun ShiftEntity.toRecord() = ShiftRecord(
            clientId = clientId,
            serverId = serverId,
            vehicleId = vehicleId,
            status = ShiftStatus.of(status),
            segmenter = if (segmenter == "stops") Segmenter.STOPS else Segmenter.WHOLE_SHIFT,
            startedAt = startedAt,
            endedAt = endedAt,
            localDate = localDate,
            distances = totalM?.let { Distances(it, activeM ?: 0, deadheadM ?: 0, personalM ?: 0) },
            calcVersion = calcVersion,
            inputDigest = inputDigest,
            phoneFlags = flagsJson?.let { runCatching { JSON.decodeFromString(FLAGS, it) }.getOrNull() } ?: emptyList(),
            serverFlags = serverFlagsJson?.let(::decodeServerFlags) ?: emptyList(),
            calcSource = CalcSource.of(calcSource),
            serverTotalM = serverTotalM,
            recon = ReconStatus.of(reconStatus),
            reconReasons = runCatching { JSON.decodeFromString(STRINGS, reconReasonsJson) }.getOrDefault(emptyList()),
            manifest = if (firstSeq != null && lastSeq != null && pointCount != null) PointManifest(firstSeq, lastSeq, pointCount) else null,
            autoClosed = autoClosed,
            clockSkewMs = clockSkewMs,
            notes = notes,
            updatedAt = updatedAt,
            sendState = SendState.of(syncState),
            serverDeductionCents = serverDeductionCents,
            serverDeductionKnown = serverDeductionKnown,
            serverHasOtherShift = serverHasOtherShift,
            batteryStart = batteryStartPct?.let { BatteryReading(it, batteryStartCharging == true) },
            batteryEnd = batteryEndPct?.let { BatteryReading(it, batteryEndCharging == true) },
            engineMs = engineMs,
            instanceId = instanceId,
        )

        fun TripRecord.toEntity() = TripEntity(
            tripKey, shiftClientId, serverId, kind(kind), kind(originalKind), source.wire, startedAt, endedAt,
            startLatE7, startLonE7, endLatE7, endLonE7, distanceM, purpose, editedAt, sendState.wire,
        )

        fun TripEntity.toRecord() = TripRecord(
            tripKey, shiftClientId, serverId, kindOf(kind), kindOf(originalKind), TripSource.of(source), startedAt, endedAt,
            startLatE7, startLonE7, endLatE7, endLonE7, distanceM, purpose, editedAt, SendState.of(syncState),
        )

        fun OdometerEntity.toRecord() =
            OdometerKind.of(kind)?.let { OdometerRecord(shiftClientId, it, readingM, recordedAt, serverId, SendState.of(syncState)) }

        fun InterruptionEntity.toInterruption() =
            Interruption(fromMs, toMs, runCatching { InterruptionReason.valueOf(reason) }.getOrDefault(InterruptionReason.SERVICE_RESTARTED))

        fun FixEntity.toFix() = RecordedFix(
            seq, shiftClientId, recordedAt, latE7, lonE7, accuracyM, speedDmps, bearingDeg, altitudeM, provider, elapsedRealtimeMs, phoneTimeMs,
        )

        fun RecordedFix.toEntity(shift: String) = FixEntity(
            seq = 0,
            shiftClientId = shift,
            recordedAt = recordedAt,
            latE7 = latE7,
            lonE7 = lonE7,
            accuracyM = accuracyM,
            speedDmps = speedDmps,
            bearingDeg = bearingDeg,
            altitudeM = altitudeM,
            provider = provider,
            elapsedRealtimeMs = elapsedRealtimeMs,
            phoneTimeMs = phoneTimeMs,
        )

        fun OutboxEntity.toItem(): OutboxItem? {
            val k = ChangeType.of(kind) ?: return null
            val b = runCatching { JSON.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            return OutboxItem(id, k, entityKey, b, createdAt, attempts, lastError, status == "parked")
        }

        fun ResendEntity.toMark() = ResendMark(shiftClientId, gen, ResendMark.Phase.of(phase), afterSeq)
    }
}
