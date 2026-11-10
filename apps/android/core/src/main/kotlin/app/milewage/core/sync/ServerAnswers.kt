package app.milewage.core.sync

import app.milewage.core.api.Recon
import app.milewage.core.api.Shift
import app.milewage.core.ports.Clock
import app.milewage.core.shift.CalcSource
import app.milewage.core.shift.Distances
import app.milewage.core.shift.LocalStore
import app.milewage.core.shift.OverwriteEntry
import app.milewage.core.shift.OverwriteReason
import app.milewage.core.shift.ReconStatus
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ServerFlag
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.ShiftStatus
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/** What the server's answers change on the phone. The server's numbers win; the phone's are never lost. */
internal class ServerAnswers(private val store: LocalStore, private val clock: Clock) {
    /**
     * The server answered `shift.end` (15 section 7): its numbers are shown from now on and the
     * shift is sent. A difference keeps the phone's numbers in the overwrite log (`recon_diff`), so
     * the Difference shows both and nothing is overwritten silently.
     */
    suspend fun applyEnd(clientId: String, shift: Shift, recon: Recon?) = store.transaction {
        val cur = store.shift(clientId) ?: return@transaction
        val status = ReconStatus.of(recon?.status ?: shift.reconStatus ?: ReconStatus.PHONE_MISSING.wire)
        if (status == ReconStatus.DIFFERS) {
            store.addOverwrite(
                OverwriteEntry(
                    at = clock.nowMs(),
                    entity = "shift",
                    entityKey = clientId,
                    reason = OverwriteReason.RECON_DIFF,
                    localJson = totalsJson(cur.distances, cur.calcVersion, null).toString(),
                    serverJson = totalsJson(serverDistances(shift, cur.distances), shift.calcVersion, recon?.reasons ?: shift.reconReasons).toString(),
                ),
            )
        }
        store.upsertShift(
            cur.copy(
                serverId = shift.id,
                distances = serverDistances(shift, cur.distances),
                calcVersion = shift.calcVersion ?: cur.calcVersion,
                calcSource = CalcSource.SERVER,
                serverTotalM = shift.totalM,
                recon = status,
                reconReasons = recon?.reasons ?: shift.reconReasons,
                serverFlags = shift.flags.map { ServerFlag(it.code, it.severity) },
                sendState = SendState.SENT,
                status = if (shift.status == app.milewage.core.api.ShiftStatus.FINALIZED) ShiftStatus.FINALIZED else cur.status,
                updatedAt = clock.nowMs(),
            ),
        )
    }

    companion object {
        /** The server's distances where it sent them, the phone's where it did not (COALESCE). */
        fun serverDistances(s: Shift, cur: Distances?): Distances? {
            val total = s.totalM ?: cur?.totalM ?: return null
            return Distances(
                totalM = total,
                activeM = s.activeM ?: cur?.activeM ?: 0,
                deadheadM = s.deadheadM ?: cur?.deadheadM ?: 0,
                personalM = s.personalM ?: cur?.personalM ?: 0,
            )
        }

        fun totalsJson(d: Distances?, calcVersion: Int?, reasons: List<String>?): JsonObject = buildJsonObject {
            put("total_m", d?.totalM?.let(::JsonPrimitive) ?: JsonNull)
            put("active_m", d?.activeM?.let(::JsonPrimitive) ?: JsonNull)
            put("deadhead_m", d?.deadheadM?.let(::JsonPrimitive) ?: JsonNull)
            put("personal_m", d?.personalM?.let(::JsonPrimitive) ?: JsonNull)
            put("calc_version", calcVersion?.let(::JsonPrimitive) ?: JsonNull)
            if (reasons != null) put("reasons", JsonArray(reasons.map(::JsonPrimitive)))
        }

        /** A shift the server holds that the phone never had (imported, another phone, before a reinstall). */
        fun recordOf(s: Shift, now: Long): ShiftRecord = ShiftRecord(
            clientId = s.clientId,
            serverId = s.id,
            vehicleId = s.vehicleId,
            status = ShiftStatus.of(s.status.wireName()),
            segmenter = s.segmenter,
            startedAt = s.startedAt,
            endedAt = s.endedAt,
            localDate = s.localDate,
            distances = serverDistances(s, null),
            calcVersion = s.calcVersion,
            calcSource = CalcSource.SERVER,
            serverTotalM = s.totalM,
            recon = ReconStatus.of(s.reconStatus),
            reconReasons = s.reconReasons,
            serverFlags = s.flags.map { ServerFlag(it.code, it.severity) },
            notes = s.notes,
            updatedAt = s.updatedAt ?: now,
            sendState = SendState.SENT,
            serverDeductionCents = s.deductionCents,
            serverDeductionKnown = true,
        )
    }
}

internal fun app.milewage.core.api.ShiftStatus.wireName(): String = when (this) {
    app.milewage.core.api.ShiftStatus.ACTIVE -> "active"
    app.milewage.core.api.ShiftStatus.ENDED -> "ended"
    app.milewage.core.api.ShiftStatus.FINALIZED -> "finalized"
}
