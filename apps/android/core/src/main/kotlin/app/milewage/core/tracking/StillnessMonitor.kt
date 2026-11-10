package app.milewage.core.tracking

/** The GPS level during a shift. */
enum class PowerLevel {
    /** GPS at the cadence interval (5 s): every fix of a moving shift. */
    FULL,

    /** The low-power watch: sparse GPS and network, passive fixes, the significant-motion sensor. */
    LOW,
}

sealed interface StillnessEvent {
    /** Drop to the low-power watch. */
    data class EnterLowPower(val reason: Reason) : StillnessEvent {
        enum class Reason {
            /** Within the still radius for the still timeout. */
            STILL,

            /** No usable fix for [StillnessConfig.noSignalMs] (indoors, a car park): searching costs the most. */
            NO_SIGNAL,
        }
    }

    /** Back to full cadence. */
    data class WakeUp(val reason: Reason) : StillnessEvent {
        enum class Reason { MOVED, SPEED, SIGNIFICANT_MOTION }
    }

    /** Post "Still on shift?": no movement since [stillSinceMs]. */
    data class PostNudge(val stillSinceMs: Long) : StillnessEvent

    /** Take the nudge down (the phone moved, or the driver answered). */
    data object CancelNudge : StillnessEvent
}

/**
 * Thresholds of [StillnessMonitor]. [stillTimeoutMs] comes from [CadenceConfig] (150 s) and
 * [nudgeAfterMs] from [TrackingSettings] (30 min, 0 is off).
 */
data class StillnessConfig(
    val stillTimeoutMs: Long = 150_000L,
    /**
     * A fix further than this from the still anchor (or than the worse of the two accuracy radii,
     * if larger) is movement. 40 m is the engine's stop radius (`STOP_RADIUS_DM`), so the watch
     * never sleeps through a move the engine would see as leaving a stop.
     */
    val stillRadiusM: Double = 40.0,
    /** A usable fix reporting this speed (9 km/h) is movement even inside the radius. */
    val wakeSpeedMps: Double = 2.5,
    val noSignalMs: Long = 300_000L,
    val nudgeAfterMs: Long = TrackingSettings.DEFAULT_NUDGE_MS,
) {
    companion object {
        fun of(settings: TrackingSettings) =
            StillnessConfig(stillTimeoutMs = settings.cadence.stillTimeoutMs, nudgeAfterMs = settings.nudgeAfterMs)
    }
}

/**
 * The in-shift battery switch and the "Still on shift?" nudge. Replaces the Expo tracker's
 * Google activity transitions (STILL for 150 s paused the GPS; any movement resumed it) with the
 * phone's own fixes and the significant-motion sensor, so it works without Google Play Services.
 *
 * Rules, all on the phone's clock ([Sample.atMs]):
 *
 * - The still anchor is a usable fix (accuracy at most 50 m). A fix further from it than
 *   `max(stillRadiusM, anchor accuracy + fix accuracy)`, or a usable fix reporting at least
 *   [StillnessConfig.wakeSpeedMps], is movement: the anchor moves there and stillness starts
 *   again. A coarse fix (network) can only signal movement when it is clearly outside both radii;
 *   it never becomes the anchor.
 * - FULL to LOW on a usable fix inside the radius that comes the still timeout after the later of
 *   the anchor and the last wake-up (positive evidence of rest: no fixes at all, as in a tunnel,
 *   is not); or when no usable fix arrived for [StillnessConfig.noSignalMs] (searching for a
 *   signal indoors is the most expensive GPS state, and there is nothing to record anyway).
 * - LOW to FULL on movement in a sparse fix, or on the significant-motion sensor. A wake-up stays
 *   FULL for at least the still timeout, so a short walk before driving off does not put the GPS
 *   back to sleep just as the drive starts: waking too early costs some battery, waking too late
 *   costs miles (the engine joins the gap with a straight line).
 * - The nudge goes up once per still period, after [StillnessConfig.nudgeAfterMs] without
 *   movement; movement or "Keep going" takes it down, and after "Keep going" it does not return
 *   until the phone has moved and been still again. It never ends a shift.
 */
class StillnessMonitor(var config: StillnessConfig, startedAtMs: Long) {
    var power: PowerLevel = PowerLevel.FULL
        private set
    private var anchor: Sample? = null
    /** Start of the current still period: the last movement (or the first fix). Null before any fix. */
    var stillSinceMs: Long? = null
        private set
    private var fullSinceMs: Long = startedAtMs
    private var lastUsableAtMs: Long = Long.MIN_VALUE
    private var nudgeUp = false
    private var nudgeAnswered = false

    fun onFix(s: Sample): List<StillnessEvent> {
        val out = ArrayList<StillnessEvent>()
        if (s.qualified && s.atMs > lastUsableAtMs) lastUsableAtMs = s.atMs
        val a = anchor
        if (a == null) {
            if (s.qualified) {
                anchor = s
                if (stillSinceMs == null) stillSinceMs = s.atMs
            }
            return out + evaluate(s.atMs, fixInRadius = false)
        }
        val moved = a.metresTo(s) > maxOf(config.stillRadiusM, a.accuracyM + s.accuracyM)
        val fast = s.qualified && (s.speedMps ?: 0.0) >= config.wakeSpeedMps
        if (moved || fast) {
            anchor = if (s.qualified) s else null
            stillSinceMs = s.atMs
            if (nudgeUp) out += StillnessEvent.CancelNudge
            nudgeUp = false
            nudgeAnswered = false
            if (power == PowerLevel.LOW) {
                power = PowerLevel.FULL
                fullSinceMs = s.atMs
                out += StillnessEvent.WakeUp(if (moved) StillnessEvent.WakeUp.Reason.MOVED else StillnessEvent.WakeUp.Reason.SPEED)
            }
        }
        return out + evaluate(s.atMs, fixInRadius = s.qualified && !moved && !fast)
    }

    /** The significant-motion sensor fired (it is only armed in LOW). */
    fun onSignificantMotion(nowMs: Long): List<StillnessEvent> {
        if (power != PowerLevel.LOW) return emptyList()
        power = PowerLevel.FULL
        fullSinceMs = nowMs
        return listOf(StillnessEvent.WakeUp(StillnessEvent.WakeUp.Reason.SIGNIFICANT_MOTION))
    }

    fun onTick(nowMs: Long): List<StillnessEvent> = evaluate(nowMs, fixInRadius = false)

    /** "Keep going" on the nudge. */
    fun keepGoing(): List<StillnessEvent> {
        nudgeAnswered = true
        val wasUp = nudgeUp
        nudgeUp = false
        return if (wasUp) listOf(StillnessEvent.CancelNudge) else emptyList()
    }

    /** When the next time-based change can happen, so the service can wake for it; null if none. */
    fun nextDeadlineMs(): Long? {
        val c = ArrayList<Long>()
        val since = stillSinceMs
        // Going still is decided on a fix (positive evidence), so only "no signal" needs a wake-up.
        if (power == PowerLevel.FULL) c += maxOf(lastUsableAtMs, fullSinceMs) + config.noSignalMs
        if (config.nudgeAfterMs > 0 && since != null && !nudgeUp && !nudgeAnswered) c += since + config.nudgeAfterMs
        return c.minOrNull()
    }

    /**
     * Time-based changes. Still enough is only judged on a usable fix inside the radius
     * ([fixInRadius]): a tunnel or a phone in a bag gives no fixes, which is not evidence of rest.
     */
    private fun evaluate(nowMs: Long, fixInRadius: Boolean): List<StillnessEvent> {
        val out = ArrayList<StillnessEvent>()
        val since = stillSinceMs
        if (power == PowerLevel.FULL) {
            val stillEnough = fixInRadius && since != null && nowMs - maxOf(since, fullSinceMs) >= config.stillTimeoutMs
            val noSignal = nowMs - maxOf(lastUsableAtMs, fullSinceMs) >= config.noSignalMs
            if (stillEnough || noSignal) {
                power = PowerLevel.LOW
                out += StillnessEvent.EnterLowPower(
                    if (stillEnough) StillnessEvent.EnterLowPower.Reason.STILL else StillnessEvent.EnterLowPower.Reason.NO_SIGNAL,
                )
            }
        }
        if (config.nudgeAfterMs > 0 && since != null && !nudgeUp && !nudgeAnswered && nowMs - since >= config.nudgeAfterMs) {
            nudgeUp = true
            out += StillnessEvent.PostNudge(since)
        }
        return out
    }

    fun snapshot(): String = Snapshot.Builder()
        .put("v", 1)
        .put("power", power.name)
        .put("anchor", Snapshot.encodeSample(anchor))
        .put("stillSince", stillSinceMs)
        .put("fullSince", fullSinceMs)
        .put("lastUsable", lastUsableAtMs)
        .put("nudgeUp", nudgeUp)
        .put("nudgeAnswered", nudgeAnswered)
        .encode()

    companion object {
        /** Restores a [snapshot]; a missing or damaged one gives a fresh monitor at full power. */
        fun restore(text: String?, config: StillnessConfig, startedAtMs: Long): StillnessMonitor {
            val m = StillnessMonitor(config, startedAtMs)
            val s = Snapshot.decode(text)
            if (s.int("v") != 1) return m
            m.power = PowerLevel.entries.firstOrNull { it.name == s.string("power") } ?: PowerLevel.FULL
            m.anchor = Snapshot.decodeSample(s.string("anchor"))
            m.stillSinceMs = s.long("stillSince")
            m.fullSinceMs = s.long("fullSince") ?: startedAtMs
            m.lastUsableAtMs = s.long("lastUsable") ?: Long.MIN_VALUE
            m.nudgeUp = s.bool("nudgeUp") ?: false
            m.nudgeAnswered = s.bool("nudgeAnswered") ?: false
            return m
        }
    }
}
