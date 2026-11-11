package app.milewage.core.tracking

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** What the Android service must do after a call into [TrackingCore]. */
sealed interface TrackingEffect {
    /** Replace the location requests (and the significant-motion trigger) with these. */
    data class ApplyPlan(val plan: LocationPlan) : TrackingEffect

    /** Show (or update) the ongoing shift notification. */
    data class ShowShift(val notice: ShiftNotice, val text: ShiftNotice.Text) : TrackingEffect

    /** Post "Still on shift?". */
    data class PostNudge(val stillSinceMs: Long) : TrackingEffect

    data object CancelNudge : TrackingEffect

    /** Call [TrackingCore.onTick] at this phone time at the latest; null: no deadline. */
    data class WakeAt(val atMs: Long?) : TrackingEffect

    /** Nothing left to do: stop the service. */
    data object Stop : TrackingEffect
}

/**
 * The brain of the tracking service, in plain Kotlin so all of it is tested on the JVM: which
 * mode (recording a shift, stopped), which location requests, what is stored, the live distance,
 * the low-power switch, the nudge, and what survives a kill. The Android service feeds it fixes, sensor triggers and ticks and applies the effects.
 *
 * Calls are serialised; each returns the effects to apply in order.
 */
class TrackingCore(
    private val fixStore: FixStore,
    private val activeShiftStore: ActiveShiftStore,
    private val settingsStore: TrackingSettingsStore,
    private val interruptions: InterruptionLog,
    private val stateStore: TrackingStateStore,
    private val diagnostics: TrackingDiagnostics,
    private val caps: DeviceCapabilities,
) {
    private val lock = Mutex()
    private val _status = MutableStateFlow(TrackingStatus())
    val status: StateFlow<TrackingStatus> = _status.asStateFlow()

    private var mode = TrackingMode.STOPPED
    private var settings = TrackingSettings()
    private var shift: ActiveShift? = null
    private var monitor: StillnessMonitor? = null
    private var live: LiveDistance? = null
    private var notice: ShiftNotice? = null
    private var shown: ShiftNotice.Text? = null
    private var applied: LocationPlan? = null
    private val dedupe = DuplicateFilter()
    private var storedFixes = 0
    private var lastFixAt: Long? = null
    private var gnssOffsetMs: Long? = null
    private var gnssOffsetAt: Long? = null
    private var outage: Pair<Long, InterruptionReason>? = null
    private var problem: TrackingProblem? = null
    private var lastSavedAt = Long.MIN_VALUE / 2

    val currentMode: TrackingMode get() = mode

    /** The provider whose fixes are stored, or null on a phone with no location provider. */
    private val recordingProvider: String? = when {
        caps.hasGps -> RawLocation.GPS
        caps.hasNetwork -> RawLocation.NETWORK
        else -> null
    }

    /**
     * The service started (first start, a sticky restart, the restart alarm, boot). Reads what
     * was running and resumes it: the shift with its live distance and low-power state. A service found dead while a shift recorded at full
     * rate leaves a [InterruptionReason.SERVICE_RESTARTED] interruption from its last sign of life.
     */
    suspend fun start(nowMs: Long): List<TrackingEffect> = lock.withLock {
        val out = ArrayList<TrackingEffect>()
        applied = null // a new service holds no requests yet
        shown = null
        settings = settingsStore.get()
        restoreGnss()
        outage = decodeOutage(stateStore.load(K_OUTAGE))
        val active = activeShiftStore.get()
        if (active != null) {
            resumeShift(active, nowMs)
            out += shiftNotification(force = true)
            out += plan()
            diagnostics.record("service_start", mapOf("mode" to "recording", "power" to monitor!!.power.name))
        } else {
            mode = TrackingMode.STOPPED
            out += stopEffects()
            diagnostics.record("service_start", mapOf("mode" to "stopped"))
        }
        out += save(nowMs, force = true)
        finish(out)
    }

    private suspend fun resumeShift(active: ActiveShift, nowMs: Long) {
        mode = TrackingMode.RECORDING
        shift = active
        monitor = StillnessMonitor.restore(stateStore.load(K_STILLNESS), StillnessConfig.of(settings), active.startedAt)
        notice = ShiftNotice.decode(stateStore.load(K_NOTICE), active.startedAt)
        val acc = LiveDistance(active.startedAt)
        safely("read_fixes") { fixStore.fixesFor(active.shiftClientId).forEach(acc::push) }
        live = acc
        val beat = Snapshot.decode(stateStore.load(K_HEARTBEAT))
        val beatAt = beat.long("at")
        if (beat.string("shift") == active.shiftClientId && beat.string("power") == PowerLevel.FULL.name &&
            beatAt != null && nowMs - beatAt > RESTART_GAP_MS
        ) {
            safely("record_interruption") {
                interruptions.record(active.shiftClientId, Interruption(beatAt, nowMs, InterruptionReason.SERVICE_RESTARTED))
            }
            diagnostics.record("interruption", mapOf("reason" to "service_restarted", "seconds" to ((nowMs - beatAt) / 1000).toString()))
        }
    }

    /** Starts recording [newShift]. The same shift again is a no-op. */
    suspend fun startShift(newShift: ActiveShift, nowMs: Long): List<TrackingEffect> = lock.withLock {
        val out = ArrayList<TrackingEffect>()
        if (mode == TrackingMode.RECORDING && shift?.shiftClientId == newShift.shiftClientId) {
            out += shiftNotification(force = true)
            out += plan()
            return@withLock finish(out)
        }
        if (mode == TrackingMode.RECORDING) closeShift(nowMs) // a different shift: the old one stops here
        settings = settingsStore.get()
        activeShiftStore.set(newShift)
        mode = TrackingMode.RECORDING
        shift = newShift
        stateStore.save(K_NOTICE, null)
        notice = ShiftNotice(startedAt = newShift.startedAt)
        val m = StillnessMonitor(StillnessConfig.of(settings), newShift.startedAt)
        monitor = m
        val acc = LiveDistance(newShift.startedAt)
        safely("read_fixes") { fixStore.fixesFor(newShift.shiftClientId).forEach(acc::push) }
        live = acc
        storedFixes = 0
        out += TrackingEffect.CancelNudge
        out += shiftNotification(force = true)
        out += plan()
        diagnostics.record("shift_start", emptyMap())
        out += save(nowMs, force = true)
        finish(out)
    }

    /** Stops recording: the shift is forgotten here (its fixes stay in the store). */
    suspend fun stopShift(nowMs: Long): List<TrackingEffect> = lock.withLock {
        val out = ArrayList<TrackingEffect>()
        if (mode != TrackingMode.RECORDING) {
            activeShiftStore.set(null)
            return@withLock finish(out)
        }
        closeShift(nowMs)
        out += TrackingEffect.CancelNudge
        settings = settingsStore.get()
        mode = TrackingMode.STOPPED
        out += stopEffects()
        out += save(nowMs, force = true)
        finish(out)
    }

    private suspend fun closeShift(nowMs: Long) {
        val s = shift ?: return
        activeShiftStore.set(null)
        outage?.let { (from, reason) ->
            safely("record_interruption") { interruptions.record(s.shiftClientId, Interruption(from, nowMs, reason)) }
        }
        outage = null
        stateStore.save(K_OUTAGE, null)
        stateStore.save(K_STILLNESS, null)
        stateStore.save(K_NOTICE, null)
        stateStore.save(K_HEARTBEAT, null)
        diagnostics.record("shift_stop", mapOf("stored" to storedFixes.toString()))
        shift = null
        monitor = null
        live = null
        notice = null
        shown = null
    }

    /** The cadence or nudge time changed in the store: use them now. */
    suspend fun reloadSettings(nowMs: Long): List<TrackingEffect> = lock.withLock {
        settings = settingsStore.get()
        monitor?.config = StillnessConfig.of(settings)
        applied = null
        finish(plan() + save(nowMs, force = true))
    }

    /** The app's details for the notification (today's earlier shifts, start time, vehicle). */
    suspend fun setNotice(n: ShiftNotice): List<TrackingEffect> = lock.withLock {
        if (mode != TrackingMode.RECORDING) return@withLock emptyList()
        notice = n
        stateStore.save(K_NOTICE, n.encode())
        finish(shiftNotification(force = true))
    }

    /**
     * Fixes from any listener. [nowWallMs] and [nowElapsedMs] are the phone's clocks now; each
     * fix's phone time is worked out from its elapsed-realtime stamp.
     */
    suspend fun onLocations(raws: List<RawLocation>, nowWallMs: Long, nowElapsedMs: Long): List<TrackingEffect> = lock.withLock {
        val out = ArrayList<TrackingEffect>()
        if (mode == TrackingMode.STOPPED) return@withLock out
        val toStore = ArrayList<RecordedFix>()
        val beforePower = monitor?.power
        for (raw in raws) {
            if (!dedupe.isNew(raw)) continue
            val at = raw.phoneTimeAt(nowWallMs, nowElapsedMs)
            val s = Sample.of(raw, at) ?: continue
            if (lastFixAt == null || at > lastFixAt!!) lastFixAt = at
            if (raw.isGnss) {
                gnssOffsetMs = FixMapper.gnssOffsetMs(raw.timeMs, at)
                gnssOffsetAt = at
            }
            when (mode) {
                TrackingMode.RECORDING -> {
                    val sh = shift!!
                    if (raw.provider == recordingProvider) FixMapper.toRecordedFix(sh.shiftClientId, raw, at)?.let(toStore::add)
                    out += stillnessEffects(monitor!!.onFix(s))
                }
                TrackingMode.STOPPED -> Unit
            }
        }
        store(toStore)
        if (mode == TrackingMode.RECORDING) out += shiftNotification(force = false)
        if (monitor?.power != beforePower) out += plan()
        out += save(nowWallMs, force = monitor?.power != beforePower)
        finish(out)
    }

    suspend fun onSignificantMotion(nowMs: Long): List<TrackingEffect> = lock.withLock {
        val out = ArrayList<TrackingEffect>()
        when (mode) {
            TrackingMode.RECORDING -> out += stillnessEffects(monitor!!.onSignificantMotion(nowMs))
            TrackingMode.STOPPED -> Unit
        }
        diagnostics.record("significant_motion", mapOf("mode" to mode.name))
        out += plan()
        out += save(nowMs, force = true)
        finish(out)
    }

    suspend fun onTick(nowMs: Long): List<TrackingEffect> = lock.withLock {
        val out = ArrayList<TrackingEffect>()
        val beforePower = monitor?.power
        when (mode) {
            TrackingMode.RECORDING -> out += stillnessEffects(monitor!!.onTick(nowMs))
            TrackingMode.STOPPED -> Unit
        }
        out += plan()
        out += save(nowMs, force = monitor?.power != beforePower)
        finish(out)
    }

    /** "Keep going" on the nudge. */
    suspend fun keepGoing(nowMs: Long): List<TrackingEffect> = lock.withLock {
        val out = ArrayList<TrackingEffect>()
        monitor?.keepGoing()
        out += TrackingEffect.CancelNudge
        out += save(nowMs, force = true)
        finish(out)
    }

    /**
     * Location became unusable ([available] false: the Location switch is off or permission was
     * taken) or usable again. While a shift records, the span is kept as an interruption.
     */
    suspend fun locationAvailability(available: Boolean, reason: InterruptionReason, nowMs: Long): List<TrackingEffect> = lock.withLock {
        val s = shift
        if (!available) {
            problem = if (reason == InterruptionReason.LOCATION_OFF) TrackingProblem.LOCATION_OFF else TrackingProblem.NO_LOCATION_PERMISSION
            if (s != null && outage == null) {
                outage = nowMs to reason
                stateStore.save(K_OUTAGE, encodeOutage(nowMs, reason))
                diagnostics.record("location_unavailable", mapOf("reason" to reason.name))
            }
        } else {
            problem = null
            val o = outage
            if (s != null && o != null) {
                safely("record_interruption") { interruptions.record(s.shiftClientId, Interruption(o.first, nowMs, o.second)) }
                diagnostics.record("location_available", mapOf("reason" to o.second.name, "seconds" to ((nowMs - o.first) / 1000).toString()))
            }
            outage = null
            stateStore.save(K_OUTAGE, null)
        }
        finish(emptyList())
    }

    /** A problem the service found (start refused, no provider); null clears it. */
    fun reportProblem(p: TrackingProblem?) {
        problem = p
        publish()
    }

    // ------------------------------------------------------------ helpers

    private suspend fun store(fixes: List<RecordedFix>) {
        if (fixes.isEmpty()) return
        val id = shift?.shiftClientId ?: return
        safely("append_fixes") {
            val stored = fixStore.append(id, fixes)
            stored.forEach { live?.push(it) }
            storedFixes += stored.size
        }
    }

    private fun stillnessEffects(events: List<StillnessEvent>): List<TrackingEffect> = events.mapNotNull { e ->
        when (e) {
            is StillnessEvent.EnterLowPower -> {
                diagnostics.record("power", mapOf("level" to "low", "reason" to e.reason.name))
                null
            }
            is StillnessEvent.WakeUp -> {
                diagnostics.record("power", mapOf("level" to "full", "reason" to e.reason.name))
                null
            }
            is StillnessEvent.PostNudge -> {
                diagnostics.record("nudge", mapOf("posted" to "true"))
                TrackingEffect.PostNudge(e.stillSinceMs)
            }
            StillnessEvent.CancelNudge -> TrackingEffect.CancelNudge
        }
    }

    /** The plan for the current state, only when it differs from the one applied. */
    private fun plan(): List<TrackingEffect> {
        val p = when (mode) {
            TrackingMode.RECORDING -> LocationPlan.recording(monitor!!.power, settings.cadence, caps)
            TrackingMode.STOPPED -> LocationPlan.NONE
        }
        if (p == applied) return emptyList()
        applied = p
        if (mode != TrackingMode.STOPPED && p.requests.isEmpty() && !p.significantMotion && recordingProvider == null) {
            problem = TrackingProblem.NO_LOCATION_PROVIDER
        }
        return listOf(TrackingEffect.ApplyPlan(p))
    }

    private fun stopEffects(): List<TrackingEffect> = plan() + TrackingEffect.Stop

    /** The shift notification when what it shows changed (or [force]). */
    private fun shiftNotification(force: Boolean): List<TrackingEffect> {
        val n = notice ?: return emptyList()
        val t = n.text(live?.runningTotalM() ?: 0)
        if (!force && t == shown) return emptyList()
        shown = t
        return listOf(TrackingEffect.ShowShift(n, t))
    }

    /** Persists the snapshots: at once on a state change, else at most every 30 s. */
    private suspend fun save(nowMs: Long, force: Boolean): List<TrackingEffect> {
        if (!force && nowMs - lastSavedAt < SAVE_EVERY_MS) return emptyList()
        lastSavedAt = nowMs
        val s = shift
        val m = monitor
        if (s != null && m != null) {
            stateStore.save(K_STILLNESS, m.snapshot())
            stateStore.save(
                K_HEARTBEAT,
                Snapshot.Builder().put("shift", s.shiftClientId).put("at", nowMs).put("power", m.power.name).encode(),
            )
        }
        val off = gnssOffsetMs
        val offAt = gnssOffsetAt
        if (off != null && offAt != null) stateStore.save(K_GNSS, Snapshot.Builder().put("offset", off).put("at", offAt).encode())
        return emptyList()
    }

    private suspend fun restoreGnss() {
        val g = Snapshot.decode(stateStore.load(K_GNSS))
        gnssOffsetMs = g.long("offset")
        gnssOffsetAt = g.long("at")
    }

    private fun finish(out: List<TrackingEffect>): List<TrackingEffect> {
        val deadline = when (mode) {
            TrackingMode.RECORDING -> monitor?.nextDeadlineMs()
            TrackingMode.STOPPED -> null
        }
        publish()
        return if (out.lastOrNull() is TrackingEffect.Stop) out else out + TrackingEffect.WakeAt(deadline)
    }

    private fun publish() {
        val s = shift
        _status.value = TrackingStatus(
            mode = mode,
            shiftClientId = s?.shiftClientId,
            startedAt = s?.startedAt,
            distanceM = live?.runningTotalM() ?: 0,
            power = monitor?.power,
            storedFixes = storedFixes,
            lastFixAt = lastFixAt,
            gnssOffsetMs = gnssOffsetMs,
            gnssOffsetAt = gnssOffsetAt,
            problem = problem,
        )
    }

    /** Storage failures never stop the service; they are counted (the Expo tracker logged and went on). */
    private inline fun safely(what: String, block: () -> Unit) {
        try {
            block()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            diagnostics.record("storage_error", mapOf("op" to what, "type" to (e::class.simpleName ?: "Exception")))
        }
    }

    private fun encodeOutage(from: Long, reason: InterruptionReason) =
        Snapshot.Builder().put("from", from).put("reason", reason.name).encode()

    private fun decodeOutage(text: String?): Pair<Long, InterruptionReason>? {
        val s = Snapshot.decode(text)
        val from = s.long("from") ?: return null
        val reason = InterruptionReason.entries.firstOrNull { it.name == s.string("reason") } ?: return null
        return from to reason
    }

    companion object {
        const val K_STILLNESS = "shift.stillness"
        const val K_NOTICE = "shift.notice"
        const val K_HEARTBEAT = "shift.heartbeat"
        const val K_GNSS = "gnss"
        const val K_OUTAGE = "shift.outage"

        /** A full-rate shift with no sign of life for longer than this was interrupted. */
        const val RESTART_GAP_MS = 60_000L
        const val SAVE_EVERY_MS = 30_000L
    }
}
