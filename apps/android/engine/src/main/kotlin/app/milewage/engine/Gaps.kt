// Port of packages/track-engine/src/gaps.ts.
// Gap and data-quality flags (14 sections 7, 8, 15). Flags are facts about the data:
// nothing in this file changes a distance.
package app.milewage.engine

import kotlin.math.abs

/**
 * Reading of 14 section 7.1: the time step is the silence before the segment's end fix, i.e.
 * the time since the previous plausible fix, not the whole span since the anchor. Fixes inside
 * the gate's minimum move keep the anchor but show the signal was there, so a long rest (GPS
 * asleep, then a jitter fix, then riding) is not a gap, as the spec's intent says.
 * A gap needs a silence over this AND a chord of at least GAP_MIN_CHORD_DM (14 section 7.1).
 */
const val GAP_MIN_DT_MS: Long = 90_000
const val GAP_MIN_CHORD_DM: Long = 1_000 // 100 m

/** `gap_large` when the chord is over 5 km or the time step over 10 minutes. */
const val GAP_LARGE_CHORD_DM: Long = 50_000
const val GAP_LARGE_DT_MS: Long = 600_000

/** `poor_accuracy_share` above 30% of fixes over the accuracy cut. */
const val POOR_ACCURACY_SHARE_PCT: Long = 30

/** `low_fix_density` below one accepted fix per 5 minutes of shift. */
const val LOW_FIX_DENSITY_MS: Long = 300_000

/** `clock_skew` when the median phone-vs-GNSS difference exceeds 2 minutes (14 section 15). */
const val CLOCK_SKEW_LIMIT_MS: Long = 120_000

/** `Math.floor(dtMs / 1000)`: floorDiv, which differs from `/` for a negative time. */
private fun gapDetail(dtMs: Long, chordDm: Long): String = "dt_s=${dtMs.floorDiv(1000L)},chord_m=${dmToM(chordDm)}"

fun isGap(dtMs: Long, chordDm: Long): Boolean = dtMs > GAP_MIN_DT_MS && chordDm >= GAP_MIN_CHORD_DM

data class GapResult(val flags: List<Flag>, val gapDm: Long)

/**
 * Stage 4. Flags accepted segments that crossed a signal gap, and speed spikes dropped
 * across one. The chord is already in the total (stage 3); a gap adds no special case.
 * Returns the flags and the chord decimetres counted across gaps (`stats.gap_m`).
 */
fun detectGaps(g: GateResult): GapResult {
    val flags = ArrayList<Flag>()
    var gapDm = 0L
    for (s in g.segments) {
        val dt = s.silenceMs
        if (!isGap(dt, s.distanceDm)) continue
        gapDm += s.distanceDm
        val at = s.from.recordedAt
        val detail = gapDetail(dt, s.distanceDm)
        flags.add(Flag(FlagCode.GAP_COUNTED, at, detail))
        if (s.distanceDm > GAP_LARGE_CHORD_DM || dt > GAP_LARGE_DT_MS) {
            flags.add(Flag(FlagCode.GAP_LARGE, at, detail))
        }
    }
    for (sp in g.spikes) {
        val dt = sp.silenceMs
        if (isGap(dt, sp.distanceDm)) {
            flags.add(Flag(FlagCode.GAP_DROPPED, sp.anchor.recordedAt, gapDetail(dt, sp.distanceDm)))
        }
    }
    return GapResult(flags, gapDm)
}

/** The recovery path's interruption records, copied into flags so the cause is recorded. */
fun interruptionFlags(interruptions: List<Interruption>?): List<Flag> =
    (interruptions ?: emptyList()).map { Flag(FlagCode.TRACKING_INTERRUPTED, it.fromMs, "to=${it.toMs}") }

/** Median of integer samples (lower middle for an even count). Empty gives 0. */
fun medianMs(samples: List<Long>): Long {
    if (samples.isEmpty()) return 0
    val s = samples.sorted()
    return s[(s.size - 1) / 2]
}

fun clockSkewFlag(clockSkewMs: Long?): List<Flag> {
    if (clockSkewMs == null || abs(clockSkewMs) <= CLOCK_SKEW_LIMIT_MS) return emptyList()
    return listOf(Flag(FlagCode.CLOCK_SKEW, detail = "median_ms=$clockSkewMs"))
}

/** The counts `qualityFlags` reads. */
data class QualityCounts(
    /** Fixes after stage 1. */
    val considered: Long,
    /** Dropped by stage 2. */
    val lowAccuracy: Long,
    /** Accepted by stage 3. */
    val accepted: Long,
    val shiftMs: Long,
)

/** `poor_accuracy_share` and `low_fix_density`. */
fun qualityFlags(c: QualityCounts): List<Flag> {
    val flags = ArrayList<Flag>()
    if (c.lowAccuracy * 100 > c.considered * POOR_ACCURACY_SHARE_PCT) {
        flags.add(Flag(FlagCode.POOR_ACCURACY_SHARE, detail = "low=${c.lowAccuracy},of=${c.considered}"))
    }
    if (c.shiftMs > 0 && c.accepted * LOW_FIX_DENSITY_MS < c.shiftMs) {
        flags.add(Flag(FlagCode.LOW_FIX_DENSITY, detail = "accepted=${c.accepted}"))
    }
    return flags
}

/**
 * JavaScript `<` on strings: UTF-16 code unit order. Kotlin's String.compareTo compares UTF-16
 * chars on every platform, which is the same order (not code point order).
 */
internal fun cmp(a: String, b: String): Int {
    val c = a.compareTo(b)
    return if (c < 0) -1 else if (c > 0) 1 else 0
}

/** Fixed flag order: (code, time, detail). No unordered iteration anywhere (14 section 9.1). */
fun sortFlags(flags: List<Flag>): List<Flag> =
    flags.sortedWith { a, b ->
        var c = cmp(a.code.wire, b.code.wire)
        if (c == 0) c = (a.at ?: 0L).compareTo(b.at ?: 0L)
        if (c == 0) c = cmp(a.detail ?: "", b.detail ?: "")
        c
    }

/**
 * Unfinished shift (14 section 7.4): the end the app offers is the time of the last
 * qualified fix at or after the shift start, never "now". Returns null without one.
 * The caller then sets `autoClosed = true` on the ShiftInput.
 */
fun lastFixEnd(fixes: List<Fix>, startedAt: Long): Long? {
    var last: Long? = null
    for (f in fixes) {
        if (f.accuracyM > 50 || f.recordedAt < startedAt) continue
        if (last == null || f.recordedAt > last) last = f.recordedAt
    }
    return last
}
