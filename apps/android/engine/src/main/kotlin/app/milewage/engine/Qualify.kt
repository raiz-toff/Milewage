// Port of packages/track-engine/src/qualify.ts.
package app.milewage.engine

/** Fixes with a larger horizontal accuracy radius are skipped (14 section 5.2). */
const val MAX_ACCURACY_M: Int = 50

fun isQualified(f: Fix): Boolean = f.accuracyM <= MAX_ACCURACY_M

/** Stage 2: drop `accuracyM > 50`. Order is preserved. */
fun qualify(fixes: List<Fix>): List<Fix> = fixes.filter(::isQualified)
