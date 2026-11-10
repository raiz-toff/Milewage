// Port of packages/track-engine/src/ints.ts. Integer-only helpers (14 section 9).
//
// JavaScript does this arithmetic on doubles; every value here stays below 2^53, where a double
// holds the integer exactly, so Long arithmetic gives the same numbers. Math.floor of a quotient
// is floorDiv (rounds toward minus infinity), never Kotlin's `/` (rounds toward zero).
package app.milewage.engine

import kotlin.math.floor

/** degrees -> latE7 / lonE7 */
const val E7: Int = 10_000_000

/** Distances are summed in decimetres. */
const val DM_PER_M: Long = 10

/** Round to the nearest integer, halves toward +infinity: `Math.floor(x + 0.5)`. */
fun roundHalfUp(x: Double): Long = floor(x + 0.5).toLong()

/** Degrees to an E7 integer. Valid for |deg| < 214.7 (an Int); coordinates are within +-180. */
fun degToE7(deg: Double): Int = roundHalfUp(deg * E7).toInt()

/** E7 integer to degrees (for the haversine and display only). */
fun e7ToDeg(e7: Int): Double = e7.toDouble() / E7

/**
 * Integer division rounded to nearest, halves up. `den` must be a positive integer.
 * TypeScript: `Math.floor((2 * num + den) / (2 * den))` on doubles, which equals the exact floor
 * while `2 * num + den` is below 2^53 (any shift: 2^53 dm is 9e11 km).
 */
fun divRound(num: Long, den: Long): Long = (2 * num + den).floorDiv(2 * den)

/** Metres to decimetres (exact). */
fun mToDm(m: Long): Long = m * DM_PER_M

/** Decimetres to metres, rounded once (14 section 9.1 rule 2). */
fun dmToM(dm: Long): Long = divRound(dm, DM_PER_M)
