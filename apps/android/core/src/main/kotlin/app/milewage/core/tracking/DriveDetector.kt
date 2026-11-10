package app.milewage.core.tracking

/**
 * Where the drive prompt detector is.
 *
 * ```
 *            enable                  suspicion                      confirmed
 *   OFF ───────────────▶ IDLE ─────────────────────▶ PROBING ─────────────────────▶ DETECTED (prompt up)
 *    ▲  disable (any)     ▲ ▲   probe failed (backoff)  │                             │  │  │
 *    │                    │ └───────────────────────────┘          "Not now", no answer │  │  │ drive ended
 *    │                    │                                         in 15 min           ▼  ▼  ▼
 *    │                    └──────────── quiet period over and the drive ended ────── COOLDOWN
 *    │                                                                                   ▲
 *    │   shift starts (any state) ──▶ PAUSED ── shift ends ───────────────────────────────┘
 * ```
 */
enum class DetectorState { OFF, IDLE, PROBING, DETECTED, COOLDOWN, PAUSED }

/** What the location requests should be while no shift runs. */
enum class WatchPower {
    /** Nothing: detection off, or a shift is recording (the shift's own requests apply). */
    NONE,

    /** Cheap watch: passive fixes, sparse network fixes, the significant-motion sensor. */
    IDLE,

    /** A short GPS look to confirm or dismiss a suspicion. */
    PROBE,

    /** GPS at the shift cadence while the prompt is up, so a "Start" loses no miles. */
    DETECTED,
}

sealed interface DetectorEvent {
    /** Post "You seem to be driving. Start a shift?"; the drive started at [driveStartedAtMs] (phone clock). */
    data class Prompt(val driveStartedAtMs: Long) : DetectorEvent

    /** Take the prompt down without an answer. */
    data class WithdrawPrompt(val reason: Reason) : DetectorEvent {
        enum class Reason { DRIVE_ENDED, NO_ANSWER }
    }

    /** For diagnostics: a probe began or ended, and why. */
    data class Probe(val started: Boolean, val reason: String) : DetectorEvent
}

/**
 * Thresholds of [DriveDetector]. The speeds decide who gets a prompt:
 *
 * - **Fast** (cars, motorbikes, fast e-bikes): 3 usable fixes in a row, each step at 25 km/h or
 *   more (the reported speed, or the implied speed where none is reported), over 4 s to 2 min, and
 *   the straight line from first to last at least 70% of what that speed implies. Confirms in
 *   about 10 to 30 s of driving. The straight-line check stops a single wild fix and its way back
 *   from looking like two fast steps.
 * - **Sustained** (bicycles, scooters, slow traffic): over the last 3 minutes, at least 6 usable
 *   fixes, at least 90 s spent moving (steps at 10 km/h or more), a moving speed of 14 km/h or
 *   more, and at least 400 m from start to end. The moving speed leaves out the time at traffic
 *   lights, so city cycling at 15 to 25 km/h passes even with a red light every few hundred
 *   metres; walking (5 km/h) and jogging (10 to 12 km/h) never do, running only at a racing pace.
 *   The cost of the lower threshold is the longer confirmation (3 minutes), and a prompt on a bus,
 *   which "Not now" quiets.
 */
data class DetectorConfig(
    val fastSpeedMps: Double = 25.0 / 3.6,
    val fastSpanMinMs: Long = 4_000L,
    val fastSpanMaxMs: Long = 120_000L,
    val fastStraightness: Double = 0.7,
    val sustainedSpeedMps: Double = 14.0 / 3.6,
    val sustainedWindowMs: Long = 180_000L,
    val sustainedMinFixes: Int = 6,
    val sustainedMinMovingMs: Long = 90_000L,
    val sustainedMinNetM: Double = 400.0,
    /** A step at this speed (10 km/h) keeps a probe going and links a drive back to its start. */
    val promisingSpeedMps: Double = 10.0 / 3.6,
    /** The drive's start reaches back across stops of up to a minute (traffic lights). */
    val startPauseMs: Long = 60_000L,
    /** Implied speeds above 70 m/s (252 km/h) are GPS glitches. */
    val maxPlausibleSpeedMps: Double = 70.0,
    /** Steps under this (or half the worse accuracy) are jitter in a path length. */
    val stepJitterM: Double = 10.0,
    /** Idle (sparse) fixes: a move must exceed this, or the two accuracies together. */
    val idleMinDisplacementM: Double = 60.0,
    /** An idle move this fast (9 km/h) or over a gap longer than [idleSlowMoveGapMs] starts a probe. */
    val idleProbeSpeedMps: Double = 2.5,
    val idleSlowMoveGapMs: Long = 180_000L,
    val probeMinMs: Long = 90_000L,
    val probeMaxMs: Long = 6 * 60_000L,
    val probeNoFixMs: Long = 60_000L,
    /** A probe ends when no promising step came for this long (after [probeMinMs]). */
    val probeQuietMs: Long = 90_000L,
    /** After a failed probe, no ordinary suspicion starts another for 3, 6, 12, then 20 minutes. */
    val backoffBaseMs: Long = 3 * 60_000L,
    val backoffMaxMs: Long = 20 * 60_000L,
    /** Failed probes are forgotten after this long without one. */
    val backoffResetMs: Long = 2 * 60 * 60_000L,
    /**
     * A drive has ended on a usable fix 5 minutes after the last movement (50 m or 10 km/h), or
     * after 10 minutes without any fix. No fixes for less than that (a tunnel) is not an end.
     */
    val driveEndStillMs: Long = 5 * 60_000L,
    val driveEndRadiusM: Double = 50.0,
    val driveEndNoFixMs: Long = 10 * 60_000L,
    /** A prompt nobody answers comes down after 15 minutes (the GPS stays at full rate meanwhile). */
    val promptHoldMs: Long = 15 * 60_000L,
    /** No prompt for an hour after "Not now" or an unanswered prompt, and none for the same drive. */
    val quietAfterDeclineMs: Long = 60 * 60_000L,
    /** No prompt for 30 minutes after a shift ends, and none for the drive it ended in. */
    val quietAfterShiftMs: Long = 30 * 60_000L,
    /** The fixes kept for a "Start": the last 20 minutes, at most 600. */
    val bufferMaxMs: Long = 20 * 60_000L,
    val bufferMaxFixes: Int = 600,
)

/**
 * The drive prompt's detector: a pure state machine, adapted from the reference detector
 * (openmiles `DriveDetector`: idle watch on sparse fixes, a GPS probe on suspicion, speed
 * confirmation from two sources, glitch limits, snapshots for process death). Differences: it
 * prompts instead of recording, so it has a cooldown and no trip output; it confirms slower
 * riders with a sustained-speed rule; it keeps the raw fixes since the probe so a "Start" can
 * store them under the new shift.
 *
 * Feed it every fix ([onFix]), the significant-motion sensor ([onSignificantMotion]) and ticks
 * ([onTick], at [nextDeadlineMs] at the latest). Everything runs on the phone's clock ([Sample.atMs]).
 */
class DriveDetector(var config: DetectorConfig = DetectorConfig()) {
    var state: DetectorState = DetectorState.OFF
        private set

    private var probeStartMs = 0L
    private var lastPromisingMs = 0L
    private var failedProbes = 0
    private var lastFailedMs = Long.MIN_VALUE / 2
    private var backoffUntilMs = Long.MIN_VALUE / 2

    /** Phone time the detected drive started; valid in DETECTED. */
    var driveStartedAtMs = 0L
        private set
    private var promptedAtMs = 0L
    private var moveAnchor: Sample? = null
    private var lastMovingMs = 0L
    private var lastFixMs = 0L
    private var quietUntilMs = 0L
    private var waitDriveEnd = false
    private var idleAnchor: Sample? = null
    private var idleLast: Sample? = null
    private val buffer = ArrayList<Sample>()

    val power: WatchPower
        get() = when (state) {
            DetectorState.OFF, DetectorState.PAUSED -> WatchPower.NONE
            DetectorState.IDLE, DetectorState.COOLDOWN -> WatchPower.IDLE
            DetectorState.PROBING -> WatchPower.PROBE
            DetectorState.DETECTED -> WatchPower.DETECTED
        }

    /** Detection turned on in Settings (or found on after a restart with no shift running). */
    fun enable(nowMs: Long): List<DetectorEvent> {
        if (state != DetectorState.OFF) return emptyList()
        toIdle(nowMs)
        return emptyList()
    }

    /** Detection turned off: everything is forgotten, and a prompt that is up comes down. */
    fun disable(): List<DetectorEvent> {
        val wasPrompting = state == DetectorState.DETECTED
        reset()
        state = DetectorState.OFF
        return if (wasPrompting) listOf(DetectorEvent.WithdrawPrompt(DetectorEvent.WithdrawPrompt.Reason.NO_ANSWER)) else emptyList()
    }

    fun onFix(s: Sample): List<DetectorEvent> {
        if (state == DetectorState.OFF || state == DetectorState.PAUSED) return emptyList()
        if (s.atMs > lastFixMs) lastFixMs = s.atMs
        return when (state) {
            DetectorState.IDLE -> idleFix(s)
            DetectorState.PROBING -> probingFix(s)
            DetectorState.DETECTED -> detectedFix(s)
            DetectorState.COOLDOWN -> { cooldownFix(s); evaluate(s.atMs) }
            else -> emptyList()
        }
    }

    fun onSignificantMotion(nowMs: Long): List<DetectorEvent> = when (state) {
        DetectorState.IDLE -> if (nowMs >= backoffUntilMs) startProbe(nowMs, null, "significant_motion") else emptyList()
        DetectorState.COOLDOWN -> {
            if (waitDriveEnd) lastMovingMs = maxOf(lastMovingMs, nowMs)
            emptyList()
        }
        else -> emptyList()
    }

    fun onTick(nowMs: Long): List<DetectorEvent> = evaluate(nowMs)

    /** "Not now" on the prompt (also a swipe that dismisses it). */
    fun notNow(nowMs: Long): List<DetectorEvent> {
        if (state != DetectorState.DETECTED) return emptyList()
        toCooldown(nowMs, nowMs + config.quietAfterDeclineMs, waitForDriveEnd = true)
        return emptyList()
    }

    /**
     * The buffered fixes made at or after [fromMs] (phone clock), oldest first: what a shift that
     * starts now carries over. Read before [shiftStarted], which clears them.
     */
    fun bufferedSince(fromMs: Long): List<Sample> = buffer.filter { it.atMs >= fromMs }

    /** A shift started (from the prompt or the app): the detector rests until it ends. */
    fun shiftStarted(): List<DetectorEvent> {
        if (state == DetectorState.OFF) return emptyList()
        val wasPrompting = state == DetectorState.DETECTED
        reset()
        state = DetectorState.PAUSED
        // The prompt is answered by the shift itself; the service takes it down.
        return if (wasPrompting) listOf(DetectorEvent.WithdrawPrompt(DetectorEvent.WithdrawPrompt.Reason.NO_ANSWER)) else emptyList()
    }

    /** The shift ended: quiet for a while, and not for the drive it may have ended in. */
    fun shiftEnded(nowMs: Long): List<DetectorEvent> {
        if (state != DetectorState.PAUSED) return emptyList()
        toCooldown(nowMs, nowMs + config.quietAfterShiftMs, waitForDriveEnd = true)
        return emptyList()
    }

    /** When the next time-based change can happen; null if only fixes or the sensor can change anything. */
    fun nextDeadlineMs(): Long? = when (state) {
        DetectorState.PROBING -> listOf(
            probeStartMs + config.probeNoFixMs,
            maxOf(probeStartMs + config.probeMinMs, lastPromisingMs + config.probeQuietMs),
            probeStartMs + config.probeMaxMs,
        ).min()
        DetectorState.DETECTED -> minOf(promptedAtMs + config.promptHoldMs, lastFixMs + config.driveEndNoFixMs)
        DetectorState.COOLDOWN -> if (waitDriveEnd) {
            lastFixMs + config.driveEndNoFixMs
        } else {
            quietUntilMs
        }
        else -> null
    }

    // ---------------------------------------------------------------- idle

    private fun idleFix(s: Sample): List<DetectorEvent> {
        if (s.atMs - lastFailedMs >= config.backoffResetMs) failedProbes = 0
        val reported = s.speedMps
        if (s.qualified && reported != null && reported >= config.promisingSpeedMps) {
            if (strongBypass(reported >= config.fastSpeedMps) || s.atMs >= backoffUntilMs) return startProbe(s.atMs, s, "reported_speed")
        }
        val prev = idleAnchor
        val last = idleLast
        idleLast = s
        if (prev == null) {
            idleAnchor = s
            return emptyList()
        }
        val d = prev.metresTo(s)
        val minMove = maxOf(config.idleMinDisplacementM, prev.accuracyM + s.accuracyM)
        if (d < minMove) {
            // Not a real move. Keep the anchor, but take a clearly better fix of the same place.
            if (s.accuracyM < prev.accuracyM * 0.5) idleAnchor = s.copy(atMs = prev.atMs)
            return emptyList()
        }
        idleAnchor = s
        val dt = s.atMs - prev.atMs
        if (dt <= 0) return emptyList()
        // Speed since the anchor; and, when the previous idle fix was itself a clear step away
        // (sparse fixes after a long rest), since that fix, which dates the departure better.
        var speed = d / (dt / 1000.0)
        if (last != null && last !== prev && s.atMs > last.atMs) {
            val step = last.metresTo(s)
            if (step >= maxOf(config.idleMinDisplacementM, last.accuracyM + s.accuracyM)) {
                speed = maxOf(speed, step / ((s.atMs - last.atMs) / 1000.0))
            }
        }
        if (speed > config.maxPlausibleSpeedMps) return emptyList()
        if (speed >= config.fastSpeedMps && (strongBypass(true) || s.atMs >= backoffUntilMs)) {
            return startProbe(s.atMs, s, "idle_fast_move")
        }
        if ((speed >= config.idleProbeSpeedMps || dt > config.idleSlowMoveGapMs) && s.atMs >= backoffUntilMs) {
            return startProbe(s.atMs, s, "idle_move")
        }
        return emptyList()
    }

    /** Strong evidence (vehicle speed) skips the backoff, but not after 3 failed probes in a row. */
    private fun strongBypass(strong: Boolean) = strong && failedProbes < STRONG_BYPASS_MAX_FAILS

    private fun startProbe(nowMs: Long, seed: Sample?, reason: String): List<DetectorEvent> {
        state = DetectorState.PROBING
        probeStartMs = nowMs
        lastPromisingMs = nowMs
        buffer.clear()
        if (seed != null) buffer.add(seed)
        return listOf(DetectorEvent.Probe(started = true, reason = reason))
    }

    // ------------------------------------------------------------- probing

    private fun probingFix(s: Sample): List<DetectorEvent> {
        val prev = lastUsable()
        addToBuffer(s)
        if (s.qualified && prev != null && stepSpeed(prev, s)?.let { it >= config.promisingSpeedMps } == true) {
            lastPromisingMs = s.atMs
        }
        val start = if (s.qualified) confirmedStart() else null
        if (start != null) {
            state = DetectorState.DETECTED
            driveStartedAtMs = start
            promptedAtMs = s.atMs
            moveAnchor = s
            lastMovingMs = s.atMs
            // Only the drive is carried over to a shift, not the walk to the car.
            buffer.removeAll { it.atMs < start }
            return listOf(DetectorEvent.Probe(started = false, reason = "confirmed"), DetectorEvent.Prompt(start))
        }
        return evaluate(s.atMs)
    }

    /** The speed of a step: the reported speed of the later fix, else the implied one; null for a glitch. */
    private fun stepSpeed(prev: Sample, s: Sample): Double? {
        val implied = s.impliedSpeedFrom(prev) ?: return null
        if (implied > config.maxPlausibleSpeedMps) return null
        return s.speedMps ?: implied
    }

    /** The start (phone time) of a drive confirmed by the usable fixes in the buffer, or null. */
    private fun confirmedStart(): Long? {
        val q = buffer.filter { it.qualified }
        if (q.size < 3) return null
        val last = q.last()
        // Fast: the last three usable fixes.
        val f = q.subList(q.size - 3, q.size)
        val span = f[2].atMs - f[0].atMs
        if (span in config.fastSpanMinMs..config.fastSpanMaxMs) {
            val fastSteps = (1..2).all { i -> stepSpeed(f[i - 1], f[i])?.let { it >= config.fastSpeedMps } == true }
            val straight = f[0].metresTo(f[2]) >= config.fastStraightness * config.fastSpeedMps * span / 1000.0
            if (fastSteps && straight) return driveStart(q, q.size - 3)
        }
        // Sustained: the latest window of at least sustainedWindowMs.
        val i0 = q.indexOfLast { last.atMs - it.atMs >= config.sustainedWindowMs }
        if (i0 >= 0 && q.size - i0 >= config.sustainedMinFixes) {
            val w = q.subList(i0, q.size)
            var movingM = 0.0
            var movingMs = 0L
            var anchor = w[0]
            for (k in 1 until w.size) {
                val step = anchor.metresTo(w[k])
                val dt = w[k].atMs - anchor.atMs
                if (dt <= 0 || step / (dt / 1000.0) > config.maxPlausibleSpeedMps) continue
                if (step < maxOf(config.stepJitterM, maxOf(anchor.accuracyM, w[k].accuracyM) / 2)) continue
                if (step / (dt / 1000.0) >= config.promisingSpeedMps) {
                    movingM += step
                    movingMs += dt
                }
                anchor = w[k]
            }
            if (movingMs >= config.sustainedMinMovingMs && movingM / (movingMs / 1000.0) >= config.sustainedSpeedMps &&
                w[0].metresTo(last) >= config.sustainedMinNetM
            ) {
                return driveStart(q, i0)
            }
        }
        return null
    }

    /**
     * Where the moving began: walks back from usable fix [from] over promising steps, across pauses
     * of up to [DetectorConfig.startPauseMs] (a red light), and stops at a longer slow stretch (the
     * walk to the car, the wait before it).
     */
    private fun driveStart(q: List<Sample>, from: Int): Long {
        var start = from
        var paused = 0L
        var i = from
        while (i > 0) {
            val fast = stepSpeed(q[i - 1], q[i])?.let { it >= config.promisingSpeedMps } == true
            if (fast) {
                start = i - 1
                paused = 0
            } else {
                paused += q[i].atMs - q[i - 1].atMs
                if (paused > config.startPauseMs) break
            }
            i--
        }
        return q[start].atMs
    }

    // ------------------------------------------------------------ detected

    private fun detectedFix(s: Sample): List<DetectorEvent> {
        addToBuffer(s)
        if (buffer.isNotEmpty() && buffer[0].atMs > driveStartedAtMs) driveStartedAtMs = buffer[0].atMs
        trackMovement(s)
        if (s.qualified && s.atMs - lastMovingMs >= config.driveEndStillMs) return endPrompt(s.atMs, ended = true)
        return evaluate(s.atMs)
    }

    private fun endPrompt(nowMs: Long, ended: Boolean): List<DetectorEvent> {
        toCooldown(nowMs, nowMs + config.quietAfterDeclineMs, waitForDriveEnd = !ended)
        return listOf(
            DetectorEvent.WithdrawPrompt(
                if (ended) DetectorEvent.WithdrawPrompt.Reason.DRIVE_ENDED else DetectorEvent.WithdrawPrompt.Reason.NO_ANSWER,
            ),
        )
    }

    private fun trackMovement(s: Sample) {
        if (!s.qualified) return
        val a = moveAnchor
        val fast = (s.speedMps ?: 0.0) >= config.promisingSpeedMps
        if (a == null || fast || a.metresTo(s) > maxOf(config.driveEndRadiusM, a.accuracyM)) {
            moveAnchor = s
            lastMovingMs = maxOf(lastMovingMs, s.atMs)
        }
    }

    // ------------------------------------------------------------ cooldown

    private fun cooldownFix(s: Sample) {
        if (!waitDriveEnd) return
        val a = moveAnchor
        // Sparse network fixes are coarse: a move must clear both accuracy radii as well.
        if (a == null) {
            moveAnchor = s
        } else if (a.metresTo(s) > maxOf(config.driveEndRadiusM, a.accuracyM + s.accuracyM)) {
            moveAnchor = s
            lastMovingMs = maxOf(lastMovingMs, s.atMs)
        } else {
            if (s.accuracyM < a.accuracyM * 0.5) moveAnchor = s.copy(atMs = a.atMs) // a clearly better fix of the same place
            if (s.atMs - lastMovingMs >= config.driveEndStillMs) waitDriveEnd = false
        }
    }

    // --------------------------------------------------------------- time

    private fun evaluate(nowMs: Long): List<DetectorEvent> = when (state) {
        DetectorState.PROBING -> {
            val noFix = nowMs - probeStartMs >= config.probeNoFixMs && buffer.none { it.qualified && it.atMs > probeStartMs }
            val quiet = nowMs - probeStartMs >= config.probeMinMs && nowMs - lastPromisingMs >= config.probeQuietMs
            val tooLong = nowMs - probeStartMs >= config.probeMaxMs
            if (noFix || quiet || tooLong) failProbe(nowMs, if (noFix) "no_fix" else if (quiet) "not_moving" else "too_long") else emptyList()
        }
        DetectorState.DETECTED -> {
            // Rest is judged on fixes (detectedFix); here only the clock: no answer, or no fix at all.
            val ended = nowMs - lastFixMs >= config.driveEndNoFixMs
            if (ended || nowMs - promptedAtMs >= config.promptHoldMs) endPrompt(nowMs, ended) else emptyList()
        }
        DetectorState.COOLDOWN -> {
            if (waitDriveEnd && nowMs - lastFixMs >= config.driveEndNoFixMs) waitDriveEnd = false
            if (!waitDriveEnd && nowMs >= quietUntilMs) toIdle(nowMs)
            emptyList()
        }
        else -> emptyList()
    }

    private fun failProbe(nowMs: Long, reason: String): List<DetectorEvent> {
        failedProbes++
        lastFailedMs = nowMs
        val backoff = minOf(config.backoffMaxMs, config.backoffBaseMs shl (failedProbes - 1).coerceAtMost(20))
        backoffUntilMs = nowMs + backoff
        idleAnchor = lastUsable() ?: idleAnchor
        buffer.clear()
        state = DetectorState.IDLE
        return listOf(DetectorEvent.Probe(started = false, reason = reason))
    }

    private fun toIdle(nowMs: Long) {
        state = DetectorState.IDLE
        buffer.clear()
        waitDriveEnd = false
        if (lastFixMs == 0L) lastFixMs = nowMs
    }

    private fun toCooldown(nowMs: Long, quietUntil: Long, waitForDriveEnd: Boolean) {
        state = DetectorState.COOLDOWN
        quietUntilMs = quietUntil
        waitDriveEnd = waitForDriveEnd
        moveAnchor = lastUsable() ?: moveAnchor
        lastMovingMs = nowMs
        lastFixMs = maxOf(lastFixMs, nowMs)
        idleAnchor = null
        idleLast = null
        buffer.clear()
        failedProbes = 0
        backoffUntilMs = Long.MIN_VALUE / 2
    }

    private fun reset() {
        buffer.clear()
        moveAnchor = null
        idleAnchor = null
        idleLast = null
        waitDriveEnd = false
        failedProbes = 0
        backoffUntilMs = Long.MIN_VALUE / 2
    }

    private fun lastUsable(): Sample? = buffer.lastOrNull { it.qualified }

    private fun addToBuffer(s: Sample) {
        buffer.add(s)
        val cutoff = s.atMs - config.bufferMaxMs
        while (buffer.isNotEmpty() && (buffer[0].atMs < cutoff || buffer.size > config.bufferMaxFixes)) buffer.removeAt(0)
    }

    fun snapshot(): String = Snapshot.Builder()
        .put("v", 1)
        .put("state", state.name)
        .put("probeStart", probeStartMs)
        .put("lastPromising", lastPromisingMs)
        .put("failedProbes", failedProbes)
        .put("lastFailed", lastFailedMs)
        .put("backoffUntil", backoffUntilMs)
        .put("driveStarted", driveStartedAtMs)
        .put("promptedAt", promptedAtMs)
        .put("moveAnchor", Snapshot.encodeSample(moveAnchor))
        .put("lastMoving", lastMovingMs)
        .put("lastFix", lastFixMs)
        .put("quietUntil", quietUntilMs)
        .put("waitDriveEnd", waitDriveEnd)
        .put("idleAnchor", Snapshot.encodeSample(idleAnchor))
        .put("idleLast", Snapshot.encodeSample(idleLast))
        .put("buffer", Snapshot.encodeSamples(buffer))
        .encode()

    companion object {
        const val STRONG_BYPASS_MAX_FAILS = 3

        /** Restores a [snapshot]; a missing or damaged one gives a detector in OFF. */
        fun restore(text: String?, config: DetectorConfig = DetectorConfig()): DriveDetector {
            val d = DriveDetector(config)
            val s = Snapshot.decode(text)
            if (s.int("v") != 1) return d
            d.state = DetectorState.entries.firstOrNull { it.name == s.string("state") } ?: DetectorState.OFF
            d.probeStartMs = s.long("probeStart") ?: 0
            d.lastPromisingMs = s.long("lastPromising") ?: 0
            d.failedProbes = s.int("failedProbes") ?: 0
            d.lastFailedMs = s.long("lastFailed") ?: (Long.MIN_VALUE / 2)
            d.backoffUntilMs = s.long("backoffUntil") ?: (Long.MIN_VALUE / 2)
            d.driveStartedAtMs = s.long("driveStarted") ?: 0
            d.promptedAtMs = s.long("promptedAt") ?: 0
            d.moveAnchor = Snapshot.decodeSample(s.string("moveAnchor"))
            d.lastMovingMs = s.long("lastMoving") ?: 0
            d.lastFixMs = s.long("lastFix") ?: 0
            d.quietUntilMs = s.long("quietUntil") ?: 0
            d.waitDriveEnd = s.bool("waitDriveEnd") ?: false
            d.idleAnchor = Snapshot.decodeSample(s.string("idleAnchor"))
            d.idleLast = Snapshot.decodeSample(s.string("idleLast"))
            d.buffer.addAll(Snapshot.decodeSamples(s.string("buffer")))
            return d
        }
    }
}
