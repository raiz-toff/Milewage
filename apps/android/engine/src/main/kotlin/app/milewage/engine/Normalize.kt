// Port of packages/track-engine/src/normalize.ts.
package app.milewage.engine

/** Window the server accepts (14 section 5.1; 08 section 5). */
const val WINDOW_BEFORE_MS: Long = 5 * 60_000L
const val WINDOW_AFTER_MS: Long = 10 * 60_000L

/**
 * Total order on fixes: (recordedAt, seq), then content, so any input order gives one output.
 * The TypeScript subtracts (`a.recordedAt - b.recordedAt || ...`), which only its sign matters
 * for; here each field is compared, so a longitude difference beyond Int range cannot overflow.
 */
fun compareFixes(a: Fix, b: Fix): Int {
    var c = a.recordedAt.compareTo(b.recordedAt)
    if (c != 0) return c
    c = a.seq.compareTo(b.seq)
    if (c != 0) return c
    c = a.latE7.compareTo(b.latE7)
    if (c != 0) return c
    c = a.lonE7.compareTo(b.lonE7)
    if (c != 0) return c
    return a.accuracyM.compareTo(b.accuracyM)
}

/** True when a fix lies inside the shift window. */
fun inWindow(f: Fix, startedAt: Long, endedAt: Long): Boolean =
    f.recordedAt >= startedAt - WINDOW_BEFORE_MS && f.recordedAt <= endedAt + WINDOW_AFTER_MS

/**
 * Stage 1: sort by (recordedAt, seq), keep the first occurrence of each seq,
 * drop fixes outside the shift window. Does not mutate the input.
 * `sortedWith` is stable, like Array.prototype.sort in V8.
 */
fun normalize(fixes: List<Fix>, startedAt: Long, endedAt: Long): List<Fix> {
    val sorted = fixes.filter { inWindow(it, startedAt, endedAt) }.sortedWith(::compareFixes)
    val seen = HashSet<Long>()
    val out = ArrayList<Fix>(sorted.size)
    for (f in sorted) {
        if (!seen.add(f.seq)) continue
        out.add(f)
    }
    return out
}
