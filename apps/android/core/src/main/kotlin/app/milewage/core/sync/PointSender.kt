package app.milewage.core.sync

import app.milewage.core.api.ApiClient
import app.milewage.core.api.ApiCodes
import app.milewage.core.api.ApiException
import app.milewage.core.api.ShiftChange
import app.milewage.core.api.ShiftRequests
import app.milewage.core.api.TelemetryBatch
import app.milewage.core.api.TelemetryBatchResult
import app.milewage.core.api.TelemetryPoint
import app.milewage.core.pairing.DeviceClient
import app.milewage.core.pairing.DeviceSession
import app.milewage.core.ports.Clock
import app.milewage.core.shift.FixQueue
import app.milewage.core.tracking.RecordedFix
import kotlinx.coroutines.sync.Mutex

/** Counters for the `upload.window` diagnostics event (16 section 3.2). */
data class UploadStats(
    val attempts: Int = 0,
    val ok: Int = 0,
    val failNet: Int = 0,
    val fail4xx: Int = 0,
    val fail5xx: Int = 0,
    val fail429: Int = 0,
    val fail507: Int = 0,
    val bytes: Long = 0,
    val durationsMs: List<Long> = emptyList(),
)

enum class UploadState {
    IDLE,
    BACKOFF,
    WAITING_CREATE,
    PARKED,

    /** The device session stops sending (revoked, wrong server, sign-in problem). */
    HALTED,
    NOT_PAIRED,
    TRACKING_OFF,
    CANCELLED,
}

data class DrainResult(val state: UploadState, val sent: Int, val setAside: Int, val retryInMs: Long?)

/** The fix as the contract sends it. Local-only fields (provider, phone time) stay on the phone. */
fun RecordedFix.toPoint() = TelemetryPoint(seq, recordedAt, latE7, lonE7, accuracyM, speedDmps, bearingDeg, altitudeM)

/**
 * Sends the fixes still pending, oldest shift first (08 sections 4.2, 4.3, 5), a port of the Expo
 * app's `sync/points.ts`: gzip batches of 100 for the running shift and 500 for a backlog, never
 * more than 500; 413 and 422 halve the batch; a fix the server refuses is set aside, never deleted;
 * a shift the server does not know is tried 3 times, then its fixes wait until the session resumes.
 * Internal to the [Sender].
 */
class PointSender(
    private val fixes: FixQueue,
    private val session: suspend () -> DeviceClient?,
    private val device: DeviceSession,
    /** Has the shift's create been acknowledged (08 section 4.2 rule 2)? */
    private val shiftReady: suspend (String) -> Boolean,
    /** The shift's create was refused for good: its fixes must not block other shifts. */
    private val shiftParked: suspend (String) -> Boolean,
    /** Sends the queued changes (the shift's create); called before waiting for a create and on 404. */
    private val flushQueue: suspend () -> Unit,
    private val clock: Clock,
    rand: () -> Double,
) {
    private val backoff = Backoff(rand)
    private val notFound = HashMap<String, Int>()
    private val parked = HashSet<String>()
    private val busy = Mutex()
    private var hintS = DEFAULT_INTERVAL_S
    private var stats = UploadStats()

    var lastState: UploadState = UploadState.IDLE
        private set

    init {
        device.subscribe {
            // A resume (pairing again, "Send now") starts clean.
            unpark()
        }
    }

    /** Between uploads while a shift runs: 60 s, or the server's hint clamped to 10-300 s. */
    val intervalMs: Long get() = hintS * 1000

    fun takeStats(): UploadStats = stats.also { stats = UploadStats() }

    /** Forgets the shifts whose fixes were set aside meanwhile, so they are tried again. */
    fun unpark() {
        parked.clear()
        notFound.clear()
        backoff.reset()
    }

    /**
     * Uploads what is pending ([shift] only, when given), until empty, halted, a retryable failure,
     * [maxBatches] accepted batches or [shouldStop].
     */
    suspend fun drain(
        shift: String? = null,
        size: Int = LIVE_BATCH,
        maxBatches: Int? = null,
        shouldStop: () -> Boolean = { false },
    ): DrainResult {
        if (!busy.tryLock()) return DrainResult(lastState, 0, 0, null)
        try {
            return run(shift, size, maxBatches, shouldStop)
        } finally {
            busy.unlock()
        }
    }

    private fun done(state: UploadState, sent: Int, aside: Int, retryInMs: Long?): DrainResult {
        lastState = state
        return DrainResult(state, sent, aside, retryInMs)
    }

    private suspend fun run(only: String?, firstSize: Int, maxBatches: Int?, shouldStop: () -> Boolean): DrainResult {
        var sent = 0
        var aside = 0
        var batches = 0
        var size = firstSize
        while (true) {
            if (shouldStop()) return done(UploadState.CANCELLED, sent, aside, null)
            if (maxBatches != null && batches >= maxBatches) return done(UploadState.IDLE, sent, aside, null)
            val s = session() ?: return done(UploadState.NOT_PAIRED, sent, aside, null)
            if (!s.flags.tracking) return done(UploadState.TRACKING_OFF, sent, aside, null)
            if (device.halted() != null) return done(UploadState.HALTED, sent, aside, null)

            val shiftId = (if (only != null) listOf(only) else fixes.shiftsWithPending())
                .firstOrNull { it !in parked && fixes.pendingCount(it) > 0 }
                ?: return done(if (parked.isNotEmpty()) UploadState.PARKED else UploadState.IDLE, sent, aside, null)
            if (!shiftReady(shiftId)) {
                flushQueue()
                if (shiftParked(shiftId)) {
                    parked.add(shiftId) // never dropped; the driver sees the shift needs attention
                    continue
                }
                if (!shiftReady(shiftId)) return done(UploadState.WAITING_CREATE, sent, aside, backoff.next())
            }
            if (size == LIVE_BATCH && fixes.pendingCount(shiftId) > BACKLOG_BATCH) size = BACKLOG_BATCH
            val batch = fixes.pending(shiftId, size.coerceIn(1, TelemetryBatch.MAX_POINTS))
            try {
                val res = send(s.client, shiftId, batch)
                val bad = res.rejected.map { it.seq }.toSet()
                val good = batch.map { it.seq }.filter { it !in bad }
                fixes.markSent(good, clock.nowMs())
                if (bad.isNotEmpty()) fixes.setAside(bad.toList(), "server_rejected", clock.nowMs())
                sent += good.size
                aside += bad.size
                batches++
                backoff.reset()
                notFound.remove(shiftId)
                hintS = res.uploadHintS.toLong().coerceIn(10, 300)
            } catch (e: ApiException) {
                when (val out = onError(e, shiftId, batch)) {
                    is Next.Halve -> size = out.size
                    is Next.Retry -> return done(UploadState.BACKOFF, sent, aside, out.delayMs)
                    Next.Halt -> return done(UploadState.HALTED, sent, aside, null)
                    is Next.SetAside -> aside += out.count
                }
            }
        }
    }

    private suspend fun send(client: ApiClient, shiftId: String, batch: List<RecordedFix>): TelemetryBatchResult {
        val req = ShiftRequests.encode(ShiftChange.Points(shiftId, batch.map { it.toPoint() }))
        val t0 = clock.nowMs()
        stats = stats.copy(attempts = stats.attempts + 1, bytes = stats.bytes + req.body.toString().length)
        try {
            val res = client.send(req)
            stats = stats.copy(ok = stats.ok + 1, durationsMs = stats.durationsMs + (clock.nowMs() - t0))
            return ApiClient.read(TelemetryBatchResult.serializer(), res.body, res.status)
        } catch (e: ApiException) {
            stats = stats.copy(durationsMs = stats.durationsMs + (clock.nowMs() - t0))
            stats = when {
                e.status == 0 -> stats.copy(failNet = stats.failNet + 1)
                e.status == 429 -> stats.copy(fail429 = stats.fail429 + 1)
                e.status == 507 -> stats.copy(fail507 = stats.fail507 + 1)
                e.status >= 500 -> stats.copy(fail5xx = stats.fail5xx + 1)
                else -> stats.copy(fail4xx = stats.fail4xx + 1)
            }
            throw e
        }
    }

    private sealed interface Next {
        data class Halve(val size: Int) : Next

        data class Retry(val delayMs: Long) : Next

        data object Halt : Next

        data class SetAside(val count: Int) : Next
    }

    /** 08 section 4.3, row by row. */
    private suspend fun onError(e: ApiException, shiftId: String, batch: List<RecordedFix>): Next {
        val seqs = batch.map { it.seq }
        if (device.halted() != null) return Next.Halt
        if (e.status == 404 && e.code == ApiCodes.SHIFT_NOT_FOUND) {
            val n = (notFound[shiftId] ?: 0) + 1
            notFound[shiftId] = n
            flushQueue()
            if (n >= NOT_FOUND_ATTEMPTS && shiftReady(shiftId)) {
                parked.add(shiftId) // the server still does not know it: wait, never drop
                return Next.SetAside(0)
            }
            return Next.Retry(backoff.next())
        }
        if (e.status == 409 && e.code == ApiCodes.SHIFT_FINALIZED) {
            return Next.SetAside(fixes.setAside(seqs, ApiCodes.SHIFT_FINALIZED, clock.nowMs()))
        }
        ShiftRequests.halvedBatch(e, batch.size)?.let { return Next.Halve(it) }
        if (e.status == 422) return Next.SetAside(fixes.setAside(seqs, "invalid", clock.nowMs()))
        return Next.Retry(backoff.next(e.retryAfterS))
    }

    companion object {
        /** 08 section 4.2 rules 5 and 7, section 5. */
        const val LIVE_BATCH = 100
        const val BACKLOG_BATCH = 500
        const val DEFAULT_INTERVAL_S = 60L
        private const val NOT_FOUND_ATTEMPTS = 3
    }
}
