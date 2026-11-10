package app.milewage.core.sync

import app.milewage.core.api.ApiClient
import app.milewage.core.api.ApiCodes
import app.milewage.core.api.ApiException
import app.milewage.core.api.ApiJson
import app.milewage.core.api.ChangeType
import app.milewage.core.api.PhoneResult
import app.milewage.core.api.Shift
import app.milewage.core.api.ShiftChange
import app.milewage.core.api.ShiftRequests
import app.milewage.core.api.ShiftStatus
import app.milewage.core.pairing.DeviceClient
import app.milewage.core.pairing.DeviceSession
import app.milewage.core.ports.Clock
import app.milewage.core.shift.CalcSource
import app.milewage.core.shift.LocalStore
import app.milewage.core.shift.PhoneRun
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.TripSource
import app.milewage.core.shift.toApi

data class ResendResult(
    val state: State,
    val retryInMs: Long?,
    /** Shifts the server accepted again in this run. */
    val shifts: Int,
    /** Fixes sent again in this run. */
    val fixes: Int,
    /** A shift was created again: fixes the point sender set aside meanwhile may go now. */
    val recreated: Boolean,
) {
    enum class State { IDLE, OFFLINE, HALTED, CANCELLED }
}

/**
 * Sends again what a server restored from an older backup may have lost (15 section 9.3), a port
 * of the Expo app's `sync/resend.ts`. [RestoreCheck] writes a [ResendMark] per shift the server once
 * acknowledged; this sends each again, the running shift first and then oldest first, as a shift is
 * sent the first time: create, every fix still on the phone, then odometer readings, `end` and trip
 * edits through the outbox. All of it is idempotent on the server (the shift by client id, fixes by
 * `(device, seq)`, readings and edits as upserts, `end` of an ended shift answers its stored result),
 * so a shift the restore kept is answered as it is and nothing is doubled. Eviction stays blocked
 * while any mark is left. Internal to the [Sender].
 */
class RestoreResend(
    private val store: LocalStore,
    private val outbox: Outbox,
    private val runner: OutboxRunner,
    private val check: RestoreCheck,
    private val session: suspend () -> DeviceClient?,
    private val device: DeviceSession,
    /** The phone's engine run over the fixes still on the phone (the end's facts), or null. */
    private val phoneRun: suspend (ShiftRecord) -> PhoneRun?,
    private val clock: Clock,
    rand: () -> Double,
) {
    private val backoff = Backoff(rand)
    private var recreated = false

    private sealed interface Outcome {
        data object Done : Outcome

        data object Skipped : Outcome

        data object Waiting : Outcome

        data object Restarted : Outcome

        data class Stop(val state: ResendResult.State, val retryInMs: Long? = null) : Outcome
    }

    suspend fun waiting(): Boolean = store.resendMarks().isNotEmpty()

    /** For the outbox barrier: nothing of a shift goes out before the server has it again. */
    suspend fun holds(shiftClientId: String): Boolean = store.resendMark(shiftClientId)?.phase == ResendMark.Phase.TODO

    /** Shifts not yet created again; the backlog leaves them to [run]. */
    suspend fun held(): Set<String> = store.resendMarks().filter { it.phase == ResendMark.Phase.TODO }.map { it.shiftClientId }.toSet()

    /**
     * One pass. [live] is the running shift: it goes first, and ended shifts wait until it ended,
     * because the server holds one active shift and an old shift is active there from its create
     * until its end.
     */
    suspend fun run(live: String?, shouldStop: () -> Boolean): ResendResult {
        var shifts = 0
        var fixes = 0
        recreated = false
        suspend fun finish(state: ResendResult.State, retry: Long? = null): ResendResult {
            settle()
            return ResendResult(state, retry, shifts, fixes, recreated)
        }
        check.settled()
        for (pass in 0..MAX_RESTARTS) {
            var restarted = false
            for (mark in ordered(store.resendMarks(), live)) {
                if (shouldStop()) return finish(ResendResult.State.CANCELLED)
                when (val out = one(mark, live, shouldStop) { fixes += it }) {
                    Outcome.Done -> shifts++
                    Outcome.Restarted -> {
                        restarted = true
                        break
                    }
                    is Outcome.Stop -> return finish(out.state, out.retryInMs)
                    else -> Unit
                }
            }
            if (!restarted) break
        }
        return finish(ResendResult.State.IDLE)
    }

    /** Drops the marks whose `end` the server accepted again; with none left the restore notice goes. */
    suspend fun settle() {
        check.settled()
        for (m in store.resendMarks()) {
            if (m.phase != ResendMark.Phase.QUEUED) continue
            if (!outbox.has(ChangeType.SHIFT_END, m.shiftClientId)) store.dropResendMark(m)
        }
        if (store.resendMarks().isEmpty()) check.acknowledge()
    }

    private suspend fun ordered(marks: List<ResendMark>, live: String?): List<ResendMark> {
        val started = marks.associate { it.shiftClientId to (store.shift(it.shiftClientId)?.startedAt ?: 0L) }
        return marks.sortedWith(compareBy<ResendMark>({ if (it.shiftClientId == live) 0 else 1 }, { started[it.shiftClientId] }))
    }

    private suspend fun one(start: ResendMark, live: String?, shouldStop: () -> Boolean, countFixes: (Int) -> Unit): Outcome {
        if (start.phase == ResendMark.Phase.QUEUED) return Outcome.Waiting // settle() removes it once `end` is accepted
        val row = store.shift(start.shiftClientId)
        if (row == null) {
            // Deleted on the web meanwhile: the server's delete wins.
            store.dropResendMark(start)
            return Outcome.Skipped
        }
        val running = row.running
        if (live != null && row.clientId != live) return Outcome.Waiting
        // Not ended and not the shift being recorded: sent once it is, never created as an active shift
        // the phone could not end.
        if (running && row.clientId != live) return Outcome.Waiting
        if (!running && !ownedHere(row)) {
            // Known only from the server's feed: the phone has nothing of its own to send.
            if (row.sendState == SendState.ON_PHONE_ONLY) store.upsertShift(row.copy(sendState = SendState.SENT))
            store.dropResendMark(start)
            return Outcome.Skipped
        }
        val s = session() ?: return Outcome.Waiting

        // 1. The shift. 201: created again. 200: the restore kept it (answered unchanged).
        var kept: Shift? = null
        try {
            val r = s.client.send(ShiftRequests.encode(ShiftChange.Create(row.clientId, row.vehicleId, row.startedAt, row.segmenter, row.notes)))
            if (r.status == 201) {
                recreated = true
            } else {
                kept = runCatching { ApiJson.decodeFromJsonElement(Shift.serializer(), r.body ?: return@runCatching null) }.getOrNull()
                    ?: Shift(0, row.clientId, row.vehicleId, ShiftStatus.ENDED, row.segmenter, row.startedAt, localDate = row.localDate)
            }
        } catch (e: ApiException) {
            return failed(e, row)
        }
        backoff.reset()
        check.settled()
        if (kept != null && !running && kept.status != ShiftStatus.ACTIVE && row.startedAt < clock.nowMs() - REACH_MS) {
            if (row.sendState == SendState.ON_PHONE_ONLY) store.upsertShift(row.copy(sendState = SendState.SENT))
            return if (store.dropResendMark(start)) Outcome.Done else Outcome.Restarted
        }

        // 2. Every fix still on the phone, in seq order.
        var mark = start
        val sent = sendFixes(s.client, start, shouldStop, countFixes)
        when (sent) {
            is FixesResult.Stopped -> return sent.outcome
            is FixesResult.Ok -> mark = sent.mark
        }

        // 3. Odometer readings, then `end` and trip edits, through the outbox (held until now).
        queue(row)
        if (running) return if (store.dropResendMark(mark)) Outcome.Done else Outcome.Restarted
        if (!store.swapResendMark(mark, mark.copy(phase = ResendMark.Phase.QUEUED))) return Outcome.Restarted
        val r = runner.run(row.clientId)
        return when (r.state) {
            RunState.OFFLINE -> Outcome.Stop(ResendResult.State.OFFLINE, r.retryInMs ?: 0)
            RunState.HALTED -> Outcome.Stop(ResendResult.State.HALTED)
            else -> Outcome.Done
        }
    }

    /** The phone recorded this shift: it has a manifest, its own result, fixes, or queued work. */
    private suspend fun ownedHere(row: ShiftRecord): Boolean {
        if (row.manifest != null || row.inputDigest != null) return true
        if (store.after(row.clientId, 0, 1).isNotEmpty()) return true
        return store.hasAnyChange(row.clientId)
    }

    private sealed interface FixesResult {
        data class Ok(val mark: ResendMark) : FixesResult

        data class Stopped(val outcome: Outcome) : FixesResult
    }

    /**
     * The shift's fixes the server once accepted, in batches of 500, from where the last attempt
     * stopped. Fixes still pending are left to the point sender. Fixes stay on the phone.
     */
    private suspend fun sendFixes(client: ApiClient, start: ResendMark, shouldStop: () -> Boolean, count: (Int) -> Unit): FixesResult {
        val id = start.shiftClientId
        var mark = start
        var size = PointSender.BACKLOG_BATCH
        while (true) {
            if (shouldStop()) return FixesResult.Stopped(Outcome.Stop(ResendResult.State.CANCELLED))
            val page = store.after(id, mark.afterSeq, size)
            val last = page.lastOrNull() ?: return FixesResult.Ok(mark)
            val pending = store.pending(id, Int.MAX_VALUE).map { it.seq }.toHashSet()
            val batch = page.filter { it.seq !in pending }
            if (batch.isNotEmpty()) {
                try {
                    client.send(ShiftRequests.encode(ShiftChange.Points(id, batch.map { it.toPoint() })))
                    count(batch.size)
                    backoff.reset()
                } catch (e: ApiException) {
                    if (e.status == 409 && e.code == ApiCodes.SHIFT_FINALIZED) return FixesResult.Ok(mark) // nothing more fits
                    val smaller = ShiftRequests.halvedBatch(e, batch.size)
                    if (smaller != null) {
                        size = smaller
                        continue
                    }
                    if (e.status != 422) return FixesResult.Stopped(stop(e))
                    // One fix the server refuses for good: skipped here, never deleted.
                }
            }
            check.settled()
            val next = mark.copy(afterSeq = last.seq)
            if (!store.swapResendMark(mark, next)) return FixesResult.Stopped(Outcome.Restarted)
            mark = next
        }
    }

    private suspend fun queue(row: ShiftRecord) {
        val id = row.clientId
        for (o in store.odometer(id)) {
            outbox.enqueue(ShiftChange.Odometer(id, o.kind.toApi(), o.readingM.toDouble(), o.recordedAt))
        }
        val endedAt = row.endedAt
        if (row.running || endedAt == null) return
        if (!outbox.has(ChangeType.SHIFT_END, id)) outbox.enqueue(endOf(row, endedAt))
        for (t in store.trips(id)) {
            if (t.source == TripSource.MANUAL) {
                outbox.enqueue(ShiftChange.ManualTrip(id, t.tripKey, t.kind, t.startedAt, t.endedAt, t.distanceM, t.purpose, t.editedAt ?: row.updatedAt))
            } else if (t.editedAt != null) {
                outbox.enqueue(ShiftChange.Override(t.tripKey, t.kind, t.purpose, t.editedAt))
            }
        }
    }

    /**
     * `end` as at the first time: the manifest and the phone result from the fixes still on the
     * phone; with them gone, the ones stored at the end (only while the shift still shows the
     * phone's own numbers).
     */
    private suspend fun endOf(row: ShiftRecord, endedAt: Long): ShiftChange.End {
        val interruptions = store.interruptions(row.clientId).map { app.milewage.core.api.Interruption(it.fromMs, it.toMs) }
        val run = phoneRun(row)
        if (run != null) return ShiftChange.End(row.clientId, endedAt, run.manifest, run.phoneResult, interruptions)
        val d = row.distances
        val stored = if (d != null && row.calcSource == CalcSource.PHONE && row.inputDigest != null && row.calcVersion != null) {
            PhoneResult(
                calcVersion = row.calcVersion,
                segmenter = row.segmenter,
                inputDigest = row.inputDigest,
                totalM = d.totalM,
                activeM = d.activeM,
                deadheadM = d.deadheadM,
                personalM = d.personalM,
                tripsCount = store.trips(row.clientId).count { it.source == TripSource.AUTO },
            )
        } else {
            null
        }
        return ShiftChange.End(row.clientId, endedAt, row.manifest, stored, interruptions)
    }

    private suspend fun failed(e: ApiException, row: ShiftRecord): Outcome {
        if (e.status == 409 && e.code == ApiCodes.SHIFT_ALREADY_ACTIVE) return Outcome.Waiting // tried again later
        if (e.retryable || device.halted() != null) return stop(e)
        // Refused for good (a vehicle the restored server does not know): the driver sees the shift
        // needs attention; the phone keeps it and tries again on the next round.
        store.upsertShift(row.copy(sendState = SendState.NEEDS_ATTENTION))
        return Outcome.Waiting
    }

    private suspend fun stop(e: ApiException): Outcome {
        if (device.halted() != null) return Outcome.Stop(ResendResult.State.HALTED)
        return Outcome.Stop(ResendResult.State.OFFLINE, backoff.next(e.retryAfterS))
    }

    companion object {
        private const val DAY = 86_400_000L

        /**
         * A device sees only the shifts of the last 14 days (08 section 2.2): an older shift the
         * restored server kept is out of the phone's reach. One day of margin.
         */
        const val REACH_MS = 13 * DAY

        /** How often one run starts over because the server was restored again meanwhile. */
        private const val MAX_RESTARTS = 3
    }
}
