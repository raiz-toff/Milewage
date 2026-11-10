package app.milewage.core.sync

import app.milewage.core.api.ApiClient
import app.milewage.core.api.ApiCodes
import app.milewage.core.api.ApiException
import app.milewage.core.api.ChangeType
import app.milewage.core.api.EndShiftResult
import app.milewage.core.api.Settings
import app.milewage.core.api.Shift
import app.milewage.core.pairing.DeviceClient
import app.milewage.core.pairing.DeviceSession
import app.milewage.core.ports.Clock
import app.milewage.core.shift.LocalStore
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.PhoneRun
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ShiftRecord
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/** The send round in progress, or the last one, for the progress line on the home screen. */
data class Progress(
    val phase: Phase = Phase.IDLE,
    val fixesSent: Int = 0,
    /** Fixes waiting when the round started. */
    val fixesTotal: Long = 0,
    val shiftsDone: Int = 0,
    val shiftsTotal: Int = 0,
    val startedAt: Long? = null,
) {
    enum class Phase { IDLE, RUNNING, DONE, CANCELLED, WAITING, HALTED }
}

/** The one status the screens show: the banner and the round. */
data class SendStatus(val sync: SyncStatus, val progress: Progress)

/** How a round ended. [done]: nothing is left on the phone only (no queued change, no pending fix). */
data class Round(val state: State, val retryInMs: Long?, val done: Boolean) {
    enum class State { IDLE, CANCELLED, OFFLINE, HALTED, NOT_PAIRED }
}

/**
 * Sending to the server (15 section 6): everything the phone has that the server does not, in the
 * order the server needs it. A port of the Expo app's `sync/sender.ts` with its fixes from AR3 and
 * AR5: one sending module, re-pairing resumes sending at once, every queued change goes.
 *
 * A round: the server's settings first (a wrong server shows before any data goes), a shift the
 * server holds open closed first, what a restore lost, then the running shift (its create, start
 * reading and fixes in batches of 100), then the ended shifts oldest first, each as create and
 * readings, every fix in batches of 500, then `end` (the barrier: an end waits for its last fix),
 * then the running shift again, then the edits of shifts already sent, then the change log, then
 * the retention rule. Between backlog batches the running shift's fixes go first once they are
 * older than the server's upload hint.
 *
 * The server keeps one active shift per driver (409 `shift_already_active`), so shifts are opened
 * there in order: the running shift's create waits until every older shift the phone sends is
 * created and ended, and an older shift not yet created waits while the running one is open there.
 * (The Expo app sent the running shift's create first and then had its own backlog refused and
 * parked as "needs attention".) Nothing is sent while the device session is halted, and nothing on
 * the phone is dropped.
 */
class Sender(
    private val store: LocalStore,
    val outbox: Outbox,
    private val session: suspend () -> DeviceClient?,
    private val device: DeviceSession,
    private val restore: RestoreCheck,
    /** `GET /settings` first: it shows a wrong server before any data is sent (15 section 6.2 step 1). */
    private val handshake: suspend () -> Unit,
    /** The server's settings arrived through the change log. */
    onSettings: suspend (Settings) -> Unit,
    /** The phone's engine run over a shift's fixes (the restore resend's `end`). */
    phoneRun: suspend (ShiftRecord) -> PhoneRun?,
    /** Free device storage in bytes; null when it cannot be read. */
    private val freeBytes: suspend () -> Long?,
    private val clock: Clock,
    rand: () -> Double = { kotlin.random.Random.nextDouble() },
    /**
     * The server binding: [store] is then its view and [session] its guarded client, and each round
     * runs with the paired server fixed ([ServerBinding.pinned]). Null: no binding (every row is sent).
     */
    private val binding: ServerBinding? = null,
    /** The size of a body once gzipped, as the transport sends it (`upload.window`'s `bytes_gz`); null: unknown. */
    gzipSize: (ByteArray) -> Long? = { null },
) {
    private val runner = OutboxRunner(outbox, session, device, ::canSend, ::onSent, ::onRefused, rand)
    private val points = PointSender(store, session, device, ::created, ::createParked, { runner.run() }, clock, rand, gzipSize)
    private val resend = RestoreResend(store, outbox, runner, restore, session, device, phoneRun, clock, rand)
    private val puller = ChangePuller(store, outbox, session, device, onSettings, clock)
    private val answers = ServerAnswers(store, clock)

    private val roundLock = Mutex()
    private var startedRounds = 0L
    private var lastRound = Round(Round.State.IDLE, null, false)

    @Volatile
    private var cancelled = false
    private val _progress = MutableStateFlow(Progress())
    private val _changes = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private var loop: Job? = null

    /** The round in progress or the last one. */
    val progress: StateFlow<Progress> = _progress.asStateFlow()

    /** Fires when the progress or a halt changes; read [status] then. */
    val changes: SharedFlow<Unit> = _changes.asSharedFlow()

    init {
        device.subscribe {
            _changes.tryEmit(Unit)
            // Pairing again (or "Send now") lifts the halt: the loop sends at once, no restart needed (AR3).
            wake.trySend(Unit)
        }
    }

    /**
     * One round now; returns when it is over (a round already running is waited for, then one
     * more runs). True when nothing is left on the phone only. False offline, halted, cancelled or
     * with a change the server refused.
     */
    suspend fun sendNow(force: Boolean = false): Boolean = round(force).done

    /**
     * The driver's "Send now" and "Check the address": lifts every halt of the device session and
     * every refusal kept for the driver, then a round that reads the change log too. A server that
     * still refuses halts it again.
     */
    suspend fun retry(): Boolean {
        device.resume()
        if (outbox.unpark() > 0) {
            for (s in store.unsentShifts()) if (s.sendState == SendState.NEEDS_ATTENTION) store.upsertShift(s.copy(sendState = SendState.ON_PHONE_ONLY))
        }
        return sendNow(force = true)
    }

    /** "Stop sending": the round stops between two requests. Nothing needs cleaning up. */
    fun cancel() {
        cancelled = true
    }

    /** Wakes the loop for a round soon (a change was queued, a shift ended, the network came back). */
    fun kick() {
        wake.trySend(Unit)
    }

    /**
     * Rounds while the process lives: one now, then on [kick], on the retry delay after a failure,
     * and every upload interval (60 s or the server's hint) while a shift runs. Idle otherwise:
     * WorkManager's periodic worker covers a phone left alone.
     */
    fun start(scope: CoroutineScope) {
        if (loop?.isActive == true) return
        loop = scope.launch {
            while (true) {
                val r = runCatching { round(false) }.getOrNull()
                val running = store.runningShift() != null
                val wait = r?.retryInMs ?: if (running) points.intervalMs else null
                if (wait == null) wake.receive() else withTimeoutOrNull(wait) { wake.receive() }
            }
        }
    }

    fun stop() {
        loop?.cancel()
        loop = null
    }

    /** Upload counters since the last call, for the `upload.window` diagnostics event. */
    fun takeUploadStats(): UploadStats = points.takeStats()

    /** How the last round ended (`sync.state` in diagnostics): reached the server, offline, halted, not paired. */
    val lastRoundState: Round.State get() = lastRound.state

    /** True once a round has run since the process started. */
    val hasRun: Boolean get() = startedRounds > 0

    /** The server was restored from a backup and its shifts are still being sent again. */
    suspend fun restoring(): Boolean {
        restore.settled()
        return restore.restored || resend.waiting()
    }

    suspend fun status(): SendStatus {
        restore.settled()
        val counts = outbox.counts()
        val halt = device.halted()
        val state = points.lastState
        val sync = buildStatus(
            StatusInput(
                shifts = store.unsentShifts(),
                pendingFixes = store.pendingCount(),
                parkedItems = counts.parked,
                oldestQueuedAt = counts.oldestAt,
                halt = halt,
                restored = restore.restored || resend.waiting(),
                offline = lastRound.state == Round.State.OFFLINE || state == UploadState.BACKOFF || state == UploadState.WAITING_CREATE,
                storage = storageState(freeBytes()),
            ),
        )
        return SendStatus(sync, _progress.value)
    }

    /** True while anything is on the phone only: the unpair check (`pairing.unpair(waiting = ...)`). */
    suspend fun hasUnsentData(): Boolean {
        val c = outbox.counts()
        return c.pending + c.parked > 0 || store.pendingCount() > 0 || store.unsentShifts().isNotEmpty() ||
            store.resendMarks().isNotEmpty()
    }

    private suspend fun round(force: Boolean): Round {
        val arrived = startedRounds
        return roundLock.withLock {
            // A round that started after this call arrived (and has finished: the lock is ours) covers it.
            if (!force && startedRounds > arrived) return@withLock lastRound
            startedRounds++
            val r = try {
                // One server for the whole round: its rows only, and only through its own client.
                if (binding != null) binding.pinned { run(force) } else run(force)
            } catch (_: ApiException) {
                Round(Round.State.OFFLINE, null, false)
            }
            lastRound = r
            r
        }
    }

    private fun set(p: Progress) {
        _progress.value = p
        _changes.tryEmit(Unit)
    }

    private fun phaseFor(state: Round.State) = when (state) {
        Round.State.OFFLINE, Round.State.NOT_PAIRED -> Progress.Phase.WAITING
        Round.State.HALTED -> Progress.Phase.HALTED
        Round.State.CANCELLED -> Progress.Phase.CANCELLED
        Round.State.IDLE -> Progress.Phase.DONE
    }

    private suspend fun liveId(): String? = store.runningShift()?.clientId

    private suspend fun run(force: Boolean): Round {
        cancelled = false
        if (session() == null) {
            set(_progress.value.copy(phase = Progress.Phase.WAITING))
            return Round(Round.State.NOT_PAIRED, null, false)
        }
        if (device.halted() != null) {
            set(_progress.value.copy(phase = Progress.Phase.HALTED))
            return Round(Round.State.HALTED, null, false)
        }
        runCatching { handshake() }
        restore.settled()
        closeOpen()?.let {
            set(_progress.value.copy(phase = phaseFor(it.state)))
            return it
        }
        val again = resend.run(liveId()) { cancelled }
        if (again.recreated) points.unpark()
        if (again.state != ResendResult.State.IDLE) {
            val state = when (again.state) {
                ResendResult.State.OFFLINE -> Round.State.OFFLINE
                ResendResult.State.HALTED -> Round.State.HALTED
                else -> Round.State.CANCELLED
            }
            set(_progress.value.copy(phase = phaseFor(state)))
            return Round(state, again.retryInMs, false)
        }
        serveRunning()?.let {
            set(_progress.value.copy(phase = phaseFor(it.state)))
            return it
        }
        val todo = unsent()
        set(
            Progress(
                phase = Progress.Phase.RUNNING,
                fixesTotal = store.pendingCount(),
                shiftsDone = again.shifts,
                shiftsTotal = todo.size + again.shifts,
                startedAt = clock.nowMs(),
            ),
        )
        val visited = HashSet<String>()
        var ids = todo
        while (ids.isNotEmpty()) {
            for (id in ids) {
                visited.add(id)
                oneShift(id)?.let {
                    set(_progress.value.copy(phase = phaseFor(it.state)))
                    return it
                }
                set(_progress.value.copy(shiftsDone = _progress.value.shiftsDone + 1))
            }
            ids = unsent().filter { it !in visited }
        }
        // The running shift again: its create may have waited for the older shifts to close.
        serveRunning()?.let {
            set(_progress.value.copy(phase = phaseFor(it.state)))
            return it
        }
        // Edits and readings of shifts already sent, and anything left over.
        stopFor(runner.run())?.let {
            set(_progress.value.copy(phase = phaseFor(it.state)))
            return it
        }
        resend.settle()
        set(_progress.value.copy(phase = Progress.Phase.DONE))
        val sent = _progress.value.fixesSent > 0 || _progress.value.shiftsDone > 0
        puller.pull(force = force || sent)
        Retention.apply(store, restore, resend, clock)
        val c = outbox.counts()
        val left = c.pending + c.parked > 0 || store.pendingCount() > 0
        return Round(Round.State.IDLE, null, !left)
    }

    /** Ended shifts with work left (queued changes or pending fixes), oldest first, never the running one. */
    private suspend fun unsent(): List<String> {
        val live = liveId()
        val ids = LinkedHashSet<String>()
        ids.addAll(store.shiftsWithPending())
        for (i in outbox.pending()) ids.add(i.shiftClientId)
        for (i in outbox.parked()) ids.remove(i.shiftClientId)
        ids.removeAll(resend.held())
        if (live != null) {
            ids.remove(live)
            // The server holds one active shift: with the running shift open there, an older shift
            // not yet created waits until the running one ends (its create would be refused).
            if (!outbox.has(ChangeType.SHIFT_CREATE, live)) {
                ids.removeAll(ids.filter { outbox.pending().any { i -> i.kind == ChangeType.SHIFT_CREATE && i.shiftClientId == it } }.toSet())
            }
        }
        val started = ids.associateWith { store.shift(it)?.startedAt ?: Long.MAX_VALUE }
        return ids.sortedBy { started[it] }
    }

    /**
     * The server keeps one active shift. A shift it holds open (create acknowledged, end still
     * queued) is closed first, so a shift created after it is not refused with 409.
     */
    private suspend fun closeOpen(): Round? {
        for (item in outbox.pending()) {
            if (item.kind != ChangeType.SHIFT_END) continue
            if (outbox.has(ChangeType.SHIFT_CREATE, item.shiftClientId)) continue
            stopFor(runner.run(item.shiftClientId))?.let { return it }
        }
        return null
    }

    /** The running shift: its create and start reading, then its fixes in batches of at most 100. */
    private suspend fun serveRunning(): Round? {
        val live = liveId() ?: return null
        stopFor(runner.run(live))?.let { return it }
        val d = points.drain(shift = live, shouldStop = { cancelled })
        return when (d.state) {
            UploadState.HALTED -> Round(Round.State.HALTED, null, false)
            UploadState.CANCELLED -> Round(Round.State.CANCELLED, null, false)
            else -> null // offline for the live shift: the backlog may still go (the next round retries)
        }
    }

    private suspend fun runningIsDue(): Boolean {
        val live = liveId() ?: return false
        val oldest = store.pending(live, 1).firstOrNull() ?: return false
        return oldest.recordedAt <= clock.nowMs() - points.intervalMs
    }

    /** One ended shift: create and readings, all fixes, then the end. Returns the round's end to stop it. */
    private suspend fun oneShift(id: String): Round? {
        stopFor(runner.run(id))?.let { return it }
        while (true) {
            if (cancelled) return Round(Round.State.CANCELLED, null, false)
            val u = points.drain(shift = id, size = PointSender.BACKLOG_BATCH, maxBatches = 1, shouldStop = { cancelled })
            set(_progress.value.copy(fixesSent = _progress.value.fixesSent + u.sent + u.setAside))
            when (u.state) {
                UploadState.CANCELLED -> return Round(Round.State.CANCELLED, null, false)
                UploadState.BACKOFF, UploadState.WAITING_CREATE -> return Round(Round.State.OFFLINE, u.retryInMs, false)
                UploadState.HALTED -> return Round(Round.State.HALTED, null, false)
                else -> Unit
            }
            if (u.sent + u.setAside == 0) break
            if (runningIsDue()) serveRunning()
        }
        return stopFor(runner.run(id))
    }

    private fun stopFor(r: RunResult): Round? = when (r.state) {
        RunState.OFFLINE -> Round(Round.State.OFFLINE, r.retryInMs, false)
        RunState.HALTED -> Round(Round.State.HALTED, null, false)
        else -> null
    }

    /** Has the shift's create been acknowledged (08 section 4.2 rule 2)? */
    private suspend fun created(id: String): Boolean = !outbox.has(ChangeType.SHIFT_CREATE, id)

    private suspend fun createParked(id: String): Boolean =
        outbox.parked().any { it.kind == ChangeType.SHIFT_CREATE && it.shiftClientId == id }

    /**
     * `shift.end` waits until every fix of the shift is accepted or set aside (15 section 6.2). After
     * a restore nothing of a shift goes before the server has it again (15 section 9.3).
     */
    private suspend fun canSend(item: OutboxItem): Boolean {
        val id = item.shiftClientId
        if (resend.holds(id)) return false
        if (item.kind == ChangeType.SHIFT_CREATE && !mayOpen(id)) return false
        return item.kind != ChangeType.SHIFT_END || store.pendingCount(id) == 0L
    }

    /**
     * The server keeps one active shift per driver: a shift is created there only when no other
     * shift of this phone is open there (created, its end not yet accepted), and the running shift
     * only after every older shift waiting to be sent is created and ended. So neither is refused.
     */
    private suspend fun mayOpen(id: String): Boolean {
        val pending = outbox.pending()
        // A shift whose create is still queued (pending or refused and parked) is not on the server.
        val creating = (pending + outbox.parked()).filter { it.kind == ChangeType.SHIFT_CREATE }.map { it.shiftClientId }.toSet()
        val ending = pending.filter { it.kind == ChangeType.SHIFT_END }.map { it.shiftClientId }.toSet()
        if ((ending - creating).any { it != id }) return false // another shift is open on the server
        val live = liveId()
        if (live == id) {
            // Older shifts first, except one the server refused for good (it waits for the driver).
            val refused = outbox.parked().filter { it.kind == ChangeType.SHIFT_CREATE }.map { it.shiftClientId }.toSet()
            return pending.none { it.shiftClientId != id && it.shiftClientId !in refused && (it.kind == ChangeType.SHIFT_CREATE || it.kind == ChangeType.SHIFT_END) }
        }
        // The running shift is open on the server: older shifts wait until it ends.
        return live == null || live in creating
    }

    private suspend fun onSent(sent: Sent) {
        val id = sent.item.shiftClientId
        when (sent.item.kind) {
            ChangeType.SHIFT_CREATE -> {
                val shift = sent.response?.body?.let { runCatching { ApiClient.read(Shift.serializer(), it, sent.response.status) }.getOrNull() }
                store.shift(id)?.let { cur -> store.upsertShift(cur.copy(serverId = shift?.id ?: cur.serverId, serverHasOtherShift = false)) }
            }
            ChangeType.SHIFT_END -> {
                val body = sent.response?.body
                val result = body?.let { runCatching { ApiClient.read(EndShiftResult.serializer(), it, sent.response.status) }.getOrNull() }
                if (!sent.finalized && result != null) {
                    answers.applyEnd(id, result.shift, result.recon)
                } else {
                    store.shift(id)?.let { store.upsertShift(it.copy(sendState = SendState.SENT)) }
                }
            }
            ChangeType.ODOMETER_PUT -> {
                val kind = OdometerKind.of(sent.item.entityKey.substringAfter(':'))
                if (kind != null) {
                    store.odometer(id).firstOrNull { it.kind == kind }?.let { store.upsertOdometer(it.copy(sendState = SendState.SENT)) }
                }
            }
            else -> Unit
        }
    }

    private suspend fun onRefused(item: OutboxItem, e: ApiException): Refusal {
        val shift = store.shift(item.shiftClientId)
        if (item.kind == ChangeType.SHIFT_CREATE && e.status == 409 && e.code == ApiCodes.SHIFT_ALREADY_ACTIVE && shift?.running == true) {
            // Another shift runs on the server: keep recording, keep the create, tell the driver.
            store.upsertShift(shift.copy(serverHasOtherShift = true))
            return Refusal.KEEP
        }
        if (item.kind == ChangeType.SHIFT_CREATE && e.status == 409 && e.code == ApiCodes.SHIFT_ALREADY_ACTIVE) {
            val live = liveId()
            // The active shift there is this phone's own running shift: this one goes after it ends.
            if (live != null && live != item.shiftClientId && !outbox.has(ChangeType.SHIFT_CREATE, live)) return Refusal.KEEP
        }
        shift?.let { store.upsertShift(it.copy(sendState = SendState.NEEDS_ATTENTION)) }
        return Refusal.PARK
    }

    /** Waits until the loop is idle (tests). */
    internal suspend fun idle() = roundLock.withLock { }
}
