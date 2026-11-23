package app.milewage.core.shift

/**
 * "Very short" (spec 001 C1): under 2 minutes and under 160 m (0.1 mi) with nothing on it. The phone
 * only ever asks about a shift that is still running, which cannot have earnings, costs, expenses or
 * a manual trip yet (those need an ended shift), so time and distance are all it can check. The
 * server (`processing/shift-checks.ts`) and the web (`shift/checks.ts`) use the same two numbers.
 */
object VeryShortShift {
    const val MAX_MS = 120_000L
    const val MAX_M = 160L

    /** 119 s and 159 m are very short; 120 s and 160 m are not. */
    fun of(elapsedMs: Long, distanceM: Long): Boolean = elapsedMs < MAX_MS && distanceM < MAX_M
}
