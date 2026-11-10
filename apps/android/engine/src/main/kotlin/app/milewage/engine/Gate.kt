// Port of packages/track-engine/src/gate.ts.
package app.milewage.engine

/** Implied speed above this is a glitch: 42 m/s = 420 dm/s (14 section 5.3). */
const val MAX_SPEED_DMPS: Long = 420

/** The smallest move from the anchor that is ever counted: 20 m = 200 dm. */
const val MIN_MOVE_DM: Long = 200

/**
 * The minimum move for one step, in decimetres (ADR 0006): 20 m, or the worse of the two
 * reported accuracy radii (anchor and fix) when that is larger. Never below MIN_MOVE_DM, and at
 * most 500 dm because stage 2 keeps only fixes with `accuracyM <= 50`. Integers only:
 * `accuracyM` is whole metres, so this is `max(200, 10 * max(anchor, fix))` exactly.
 */
fun minMoveDm(anchor: Fix, f: Fix): Long {
    val worstM = if (anchor.accuracyM > f.accuracyM) anchor.accuracyM else f.accuracyM
    val dm = worstM.toLong() * DM_PER_M
    return if (dm > MIN_MOVE_DM) dm else MIN_MOVE_DM
}

enum class DropReason(override val wire: String) : WireEnum {
    NON_POSITIVE_DT("non_positive_dt"),
    SPEED_SPIKE("speed_spike"),
    WITHIN_GATE("within_gate"),
}

sealed interface GateStep {
    data object Anchor : GateStep

    data class Accept(val distanceDm: Long) : GateStep

    data class Drop(val reason: DropReason) : GateStep
}

/**
 * Stage 3 for one fix. `anchor` is the last accepted fix (null before the first).
 * The anchor only moves on accept; the caller sets it. Checks in order: time, speed, minimum move.
 * The counted distance is the chord from the anchor, so the metres to a fix held back by a larger
 * minimum move are not lost: the next accepted fix counts the whole chord from the same anchor.
 * Only the curve between two counted fixes and the tail at the shift's end are left out.
 */
fun gateStep(anchor: Fix?, f: Fix): GateStep {
    if (anchor == null) return GateStep.Anchor
    val dtMs = f.recordedAt - anchor.recordedAt
    if (dtMs <= 0) return GateStep.Drop(DropReason.NON_POSITIVE_DT)
    val dDm = haversineDm(anchor.latE7, anchor.lonE7, f.latE7, f.lonE7)
    // Long: 420 * dtMs is exact up to dtMs ~ 2e16 ms; JavaScript's double is exact up to 2e13 ms
    // (680 years), far beyond any shift.
    if (dDm * 1000 > MAX_SPEED_DMPS * dtMs) return GateStep.Drop(DropReason.SPEED_SPIKE)
    if (dDm < minMoveDm(anchor, f)) return GateStep.Drop(DropReason.WITHIN_GATE)
    return GateStep.Accept(dDm)
}

/** One accepted step between consecutive accepted fixes. */
data class Segment(
    val from: Fix,
    val to: Fix,
    val distanceDm: Long,
    /** Time from the previous plausible fix (accepted or inside the gate) to `to`. */
    val silenceMs: Long,
)

/** A fix dropped as a speed spike, with the anchor it was measured against. */
data class Spike(
    val fix: Fix,
    val anchor: Fix,
    val distanceDm: Long,
    val silenceMs: Long,
)

data class GateStats(val nonPositiveDt: Long, val speedSpike: Long, val withinGate: Long)

data class GateResult(
    val accepted: List<Fix>,
    val segments: List<Segment>,
    val spikes: List<Spike>,
    val distanceDm: Long,
    val distanceM: Long,
    val stats: GateStats,
)

/** Stage 3 over already normalized and qualified fixes. */
fun gate(fixes: List<Fix>): GateResult {
    val accepted = ArrayList<Fix>()
    val segments = ArrayList<Segment>()
    val spikes = ArrayList<Spike>()
    var nonPositiveDt = 0L
    var speedSpike = 0L
    var withinGate = 0L
    var anchor: Fix? = null
    var prevAt = 0L // time of the previous plausible fix; glitches do not count as signal
    var distanceDm = 0L
    for (f in fixes) {
        val step = gateStep(anchor, f)
        if (step is GateStep.Drop) {
            when (step.reason) {
                DropReason.NON_POSITIVE_DT -> nonPositiveDt++
                DropReason.SPEED_SPIKE -> speedSpike++
                DropReason.WITHIN_GATE -> withinGate++
            }
            if (step.reason == DropReason.WITHIN_GATE) prevAt = f.recordedAt
            if (step.reason == DropReason.SPEED_SPIKE && anchor != null) {
                spikes.add(
                    Spike(
                        fix = f,
                        anchor = anchor,
                        distanceDm = haversineDm(anchor.latE7, anchor.lonE7, f.latE7, f.lonE7),
                        silenceMs = f.recordedAt - prevAt,
                    ),
                )
            }
            continue
        }
        if (step is GateStep.Accept && anchor != null) {
            distanceDm += step.distanceDm
            segments.add(Segment(from = anchor, to = f, distanceDm = step.distanceDm, silenceMs = f.recordedAt - prevAt))
        }
        anchor = f
        prevAt = f.recordedAt
        accepted.add(f)
    }
    return GateResult(
        accepted = accepted,
        segments = segments,
        spikes = spikes,
        distanceDm = distanceDm,
        distanceM = dmToM(distanceDm),
        stats = GateStats(nonPositiveDt, speedSpike, withinGate),
    )
}

/** Stages 1-3 in batch: the distance part of the engine. */
fun measureDistance(fixes: List<Fix>, startedAt: Long, endedAt: Long): GateResult =
    gate(qualify(normalize(fixes, startedAt, endedAt)))
