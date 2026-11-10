// No TypeScript source: this is what `Math.sin`, `Math.cos` and `Math.atan2` are inside Node.
// A line-for-line port of V8's fdlibm (deps/v8/src/base/ieee754.cc in Node v22.22.0: `sin`,
// `cos`, `atan`, `atan2`, `__ieee754_rem_pio2`, `__kernel_rem_pio2`, `__kernel_sin`,
// `__kernel_cos`). Node is built without V8_USE_LIBM_TRIG_FUNCTIONS, so these are the functions
// the server's TypeScript engine calls. See README "Floating point".
//
// Only IEEE 754 operations that are correctly rounded on every platform are used (+, -, *, /,
// floor, truncation to Int, bit casts), so the result is the same double on the JVM, on Android
// (ART) and on Kotlin/Native. Constants are written as their bit patterns, not decimals.
//
// fdlibm: Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved. Developed at
// SunSoft, a Sun Microsystems, Inc. business. Permission to use, copy, modify, and distribute
// this software is freely granted, provided that this notice is preserved.
package app.milewage.engine

import kotlin.math.abs
import kotlin.math.floor

/** Bit-exact `Math.sin`, `Math.cos` and `Math.atan2` of V8 (Node v22). */
object FdLibm {
    private fun d(bits: Long): Double = Double.fromBits(bits)

    private fun u(bits: ULong): Double = Double.fromBits(bits.toLong())

    private fun highWord(x: Double): Int = (x.toRawBits() ushr 32).toInt()

    private fun lowWord(x: Double): Int = x.toRawBits().toInt()

    private fun fromWords(hi: Int, lo: Int): Double =
        Double.fromBits((hi.toLong() shl 32) or (lo.toLong() and 0xFFFFFFFFL))

    /** C `scalbn`: x * 2^n, exact while the result is a normal number (always here). */
    private fun scalbn(x: Double, n: Int): Double {
        var r = x
        var k = n
        while (k > 1000) {
            r *= d(0x7E70000000000000L) // 2^1000
            k -= 1000
        }
        while (k < -1000) {
            r *= d(0x0170000000000000L) // 2^-1000
            k += 1000
        }
        return r * Double.fromBits((k + 1023).toLong() shl 52)
    }

    // __ieee754_rem_pio2 constants.
    private val TWO_OVER_PI = intArrayOf(
        0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C,
        0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A, 0x424DD2, 0xE00649,
        0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129, 0xA73EE8, 0x8235F5, 0x2EBB44,
        0x84E99C, 0x7026B4, 0x5F7E41, 0x3991D6, 0x398353, 0x39F49C, 0x845F8B,
        0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D,
        0x367ECF, 0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5,
        0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330,
        0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3, 0x91615E, 0xE61B08,
        0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA,
        0x73A8C9, 0x60E27B, 0xC08C6B,
    )
    private val NPIO2_HW = intArrayOf(
        0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C,
        0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C,
        0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
        0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
        0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
        0x404858EB, 0x404921FB,
    )
    private val ZERO = 0.0
    private val HALF = d(0x3FE0000000000000L)
    private val TWO24 = d(0x4170000000000000L)
    private val INVPIO2 = d(0x3FE45F306DC9C883L)
    private val PIO2_1 = d(0x3FF921FB54400000L)
    private val PIO2_1T = d(0x3DD0B4611A626331L)
    private val PIO2_2 = d(0x3DD0B4611A600000L)
    private val PIO2_2T = d(0x3BA3198A2E037073L)
    private val PIO2_3 = d(0x3BA3198A2E000000L)
    private val PIO2_3T = d(0x397B839A252049C1L)

    /** Returns n and writes x - n*pi/2 into y[0] + y[1]. */
    internal fun remPio2(x: Double, y: DoubleArray): Int {
        var z: Double
        var w: Double
        var t: Double
        var r: Double
        val fn: Double
        val hx = highWord(x)
        val ix = hx and 0x7FFFFFFF
        if (ix <= 0x3FE921FB) { // |x| ~<= pi/4, no need for reduction
            y[0] = x
            y[1] = 0.0
            return 0
        }
        if (ix < 0x4002D97C) { // |x| < 3pi/4, special case with n=+-1
            if (hx > 0) {
                z = x - PIO2_1
                if (ix != 0x3FF921FB) { // 33+53 bit pi is good enough
                    y[0] = z - PIO2_1T
                    y[1] = (z - y[0]) - PIO2_1T
                } else { // near pi/2, use 33+33+53 bit pi
                    z -= PIO2_2
                    y[0] = z - PIO2_2T
                    y[1] = (z - y[0]) - PIO2_2T
                }
                return 1
            } else { // negative x
                z = x + PIO2_1
                if (ix != 0x3FF921FB) {
                    y[0] = z + PIO2_1T
                    y[1] = (z - y[0]) + PIO2_1T
                } else {
                    z += PIO2_2
                    y[0] = z + PIO2_2T
                    y[1] = (z - y[0]) + PIO2_2T
                }
                return -1
            }
        }
        if (ix <= 0x413921FB) { // |x| ~<= 2^19*(pi/2), medium size
            t = abs(x)
            val n = (t * INVPIO2 + HALF).toInt()
            fn = n.toDouble()
            r = t - fn * PIO2_1
            w = fn * PIO2_1T // 1st round good to 85 bit
            if (n < 32 && ix != NPIO2_HW[n - 1]) {
                y[0] = r - w // quick check no cancellation
            } else {
                val j = ix shr 20
                y[0] = r - w
                var high = highWord(y[0])
                var i = j - ((high shr 20) and 0x7FF)
                if (i > 16) { // 2nd iteration needed, good to 118
                    t = r
                    w = fn * PIO2_2
                    r = t - w
                    w = fn * PIO2_2T - ((t - r) - w)
                    y[0] = r - w
                    high = highWord(y[0])
                    i = j - ((high shr 20) and 0x7FF)
                    if (i > 49) { // 3rd iteration need, 151 bits acc
                        t = r
                        w = fn * PIO2_3
                        r = t - w
                        w = fn * PIO2_3T - ((t - r) - w)
                        y[0] = r - w
                    }
                }
            }
            y[1] = (r - y[0]) - w
            return if (hx < 0) {
                y[0] = -y[0]
                y[1] = -y[1]
                -n
            } else {
                n
            }
        }
        // all other (large) arguments
        if (ix >= 0x7FF00000) { // x is inf or NaN
            y[0] = x - x
            y[1] = y[0]
            return 0
        }
        // set z = scalbn(|x|,ilogb(x)-23)
        val low = lowWord(x)
        val e0 = (ix shr 20) - 1046 // e0 = ilogb(z)-23
        z = fromWords(ix - (e0 shl 20), low)
        val tx = DoubleArray(3)
        for (i in 0 until 2) {
            tx[i] = z.toInt().toDouble()
            z = (z - tx[i]) * TWO24
        }
        tx[2] = z
        var nx = 3
        while (tx[nx - 1] == ZERO) nx-- // skip zero term
        val n = kernelRemPio2(tx, y, e0, nx, 2, TWO_OVER_PI)
        if (hx < 0) {
            y[0] = -y[0]
            y[1] = -y[1]
            return -n
        }
        return n
    }

    private val INIT_JK = intArrayOf(2, 3, 4, 6)
    private val PIO2 = doubleArrayOf(
        d(0x3FF921FB40000000L),
        d(0x3E74442D00000000L),
        d(0x3CF8469880000000L),
        d(0x3B78CC5160000000L),
        d(0x39F01B8380000000L),
        d(0x387A252040000000L),
        d(0x36E3822280000000L),
        d(0x3569F31D00000000L),
    )
    private val TWON24 = d(0x3E70000000000000L)

    /** __kernel_rem_pio2: the large-argument reduction (prec 2, as V8 calls it). */
    @Suppress("LongMethod", "CyclomaticComplexMethod", "LongParameterList")
    private fun kernelRemPio2(x: DoubleArray, y: DoubleArray, e0: Int, nx: Int, prec: Int, ipio2: IntArray): Int {
        val iq = IntArray(20)
        val f = DoubleArray(20)
        val fq = DoubleArray(20)
        val q = DoubleArray(20)
        var z: Double
        var fw: Double
        var i: Int
        var j: Int
        var k: Int
        var n: Int
        var ih: Int
        var carry: Int

        val jk = INIT_JK[prec]
        val jp = jk

        // determine jx,jv,q0, note that 3>q0
        val jx = nx - 1
        var jv = (e0 - 3) / 24
        if (jv < 0) jv = 0
        var q0 = e0 - 24 * (jv + 1)

        // set up f[0] to f[jx+jk] where f[jx+jk] = ipio2[jv+jk]
        j = jv - jx
        val m = jx + jk
        i = 0
        while (i <= m) {
            f[i] = if (j < 0) ZERO else ipio2[j].toDouble()
            i++
            j++
        }

        // compute q[0],q[1],...q[jk]
        i = 0
        while (i <= jk) {
            fw = 0.0
            j = 0
            while (j <= jx) {
                fw += x[j] * f[jx + i - j]
                j++
            }
            q[i] = fw
            i++
        }

        var jz = jk
        while (true) { // recompute:
            // distill q[] into iq[] reversingly
            i = 0
            j = jz
            z = q[jz]
            while (j > 0) {
                fw = (TWON24 * z).toInt().toDouble()
                iq[i] = (z - TWO24 * fw).toInt()
                z = q[j - 1] + fw
                i++
                j--
            }

            // compute n
            z = scalbn(z, q0) // actual value of z
            z -= 8.0 * floor(z * 0.125) // trim off integer >= 8
            n = z.toInt()
            z -= n.toDouble()
            ih = 0
            if (q0 > 0) { // need iq[jz-1] to determine n
                i = iq[jz - 1] shr (24 - q0)
                n += i
                iq[jz - 1] -= i shl (24 - q0)
                ih = iq[jz - 1] shr (23 - q0)
            } else if (q0 == 0) {
                ih = iq[jz - 1] shr 23
            } else if (z >= 0.5) {
                ih = 2
            }

            if (ih > 0) { // q > 0.5
                n += 1
                carry = 0
                i = 0
                while (i < jz) { // compute 1-q
                    j = iq[i]
                    if (carry == 0) {
                        if (j != 0) {
                            carry = 1
                            iq[i] = 0x1000000 - j
                        }
                    } else {
                        iq[i] = 0xFFFFFF - j
                    }
                    i++
                }
                if (q0 > 0) { // rare case: chance is 1 in 12
                    when (q0) {
                        1 -> iq[jz - 1] = iq[jz - 1] and 0x7FFFFF
                        2 -> iq[jz - 1] = iq[jz - 1] and 0x3FFFFF
                    }
                }
                if (ih == 2) {
                    z = 1.0 - z
                    if (carry != 0) z -= scalbn(1.0, q0)
                }
            }

            // check if recomputation is needed
            if (z == ZERO) {
                j = 0
                i = jz - 1
                while (i >= jk) {
                    j = j or iq[i]
                    i--
                }
                if (j == 0) { // need recomputation
                    k = 1
                    while (jk >= k && iq[jk - k] == 0) k++ // k = no. of terms needed
                    i = jz + 1
                    while (i <= jz + k) { // add q[jz+1] to q[jz+k]
                        f[jx + i] = ipio2[jv + i].toDouble()
                        fw = 0.0
                        j = 0
                        while (j <= jx) {
                            fw += x[j] * f[jx + i - j]
                            j++
                        }
                        q[i] = fw
                        i++
                    }
                    jz += k
                    continue // goto recompute
                }
            }
            break
        }

        // chop off zero terms
        if (z == 0.0) {
            jz -= 1
            q0 -= 24
            while (iq[jz] == 0) {
                jz--
                q0 -= 24
            }
        } else { // break z into 24-bit if necessary
            z = scalbn(z, -q0)
            if (z >= TWO24) {
                fw = (TWON24 * z).toInt().toDouble()
                iq[jz] = (z - TWO24 * fw).toInt()
                jz += 1
                q0 += 24
                iq[jz] = fw.toInt()
            } else {
                iq[jz] = z.toInt()
            }
        }

        // convert integer "bit" chunk to floating-point value
        fw = scalbn(1.0, q0)
        i = jz
        while (i >= 0) {
            q[i] = fw * iq[i].toDouble()
            fw *= TWON24
            i--
        }

        // compute PIo2[0,...,jp]*q[jz,...,0]
        i = jz
        while (i >= 0) {
            fw = 0.0
            k = 0
            while (k <= jp && k <= jz - i) {
                fw += PIO2[k] * q[i + k]
                k++
            }
            fq[jz - i] = fw
            i--
        }

        // compress fq[] into y[] (prec 1 and 2; V8 only calls prec 2)
        fw = 0.0
        i = jz
        while (i >= 0) {
            fw += fq[i]
            i--
        }
        y[0] = if (ih == 0) fw else -fw
        fw = fq[0] - fw
        i = 1
        while (i <= jz) {
            fw += fq[i]
            i++
        }
        y[1] = if (ih == 0) fw else -fw
        return n and 7
    }

    private val C1 = d(0x3FA555555555554CL)
    private val C2 = u(0xBF56C16C16C15177UL)
    private val C3 = d(0x3EFA01A019CB1590L)
    private val C4 = u(0xBE927E4F809C52ADUL)
    private val C5 = d(0x3E21EE9EBDB4B1C4L)
    private val C6 = u(0xBDA8FAE9BE8838D4UL)

    /** __kernel_cos on [-pi/4, pi/4]; y is the tail of x. */
    private fun kernelCos(x: Double, y: Double): Double {
        val ix = highWord(x) and 0x7FFFFFFF // ix = |x|'s high word
        if (ix < 0x3E400000) { // if x < 2**27
            if (x.toInt() == 0) return 1.0 // generate inexact
        }
        val z = x * x
        val r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
        return if (ix < 0x3FD33333) { // if |x| < 0.3
            1.0 - (0.5 * z - (z * r - x * y))
        } else {
            val qx = if (ix > 0x3FE90000) { // x > 0.78125
                0.28125
            } else {
                fromWords(ix - 0x00200000, 0) // x/4
            }
            val iz = 0.5 * z - qx
            val a = 1.0 - qx
            a - (iz - (z * r - x * y))
        }
    }

    private val S1 = u(0xBFC5555555555549UL)
    private val S2 = d(0x3F8111111110F8A6L)
    private val S3 = u(0xBF2A01A019C161D5UL)
    private val S4 = d(0x3EC71DE357B1FE7DL)
    private val S5 = u(0xBE5AE5E68A2B9CEBUL)
    private val S6 = d(0x3DE5D93A5ACFD57CL)

    /** __kernel_sin on [-pi/4, pi/4]; y is the tail of x, iy == 0 when y is 0. */
    private fun kernelSin(x: Double, y: Double, iy: Int): Double {
        val ix = highWord(x) and 0x7FFFFFFF // high word of x
        if (ix < 0x3E400000) { // |x| < 2**-27
            if (x.toInt() == 0) return x // generate inexact
        }
        val z = x * x
        val v = z * x
        val r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))
        return if (iy == 0) {
            x + v * (S1 + z * r)
        } else {
            x - ((z * (HALF * y - v * r) - y) - v * S1)
        }
    }

    /** `Math.sin` of V8. */
    fun sin(x: Double): Double {
        val ix = highWord(x) and 0x7FFFFFFF
        if (ix <= 0x3FE921FB) return kernelSin(x, 0.0, 0) // |x| ~< pi/4
        if (ix >= 0x7FF00000) return x - x // sin(Inf or NaN) is NaN
        val y = DoubleArray(2) // argument reduction needed
        val n = remPio2(x, y)
        return when (n and 3) {
            0 -> kernelSin(y[0], y[1], 1)
            1 -> kernelCos(y[0], y[1])
            2 -> -kernelSin(y[0], y[1], 1)
            else -> -kernelCos(y[0], y[1])
        }
    }

    /** `Math.cos` of V8. */
    fun cos(x: Double): Double {
        val ix = highWord(x) and 0x7FFFFFFF
        if (ix <= 0x3FE921FB) return kernelCos(x, 0.0) // |x| ~< pi/4
        if (ix >= 0x7FF00000) return x - x // cos(Inf or NaN) is NaN
        val y = DoubleArray(2) // argument reduction needed
        val n = remPio2(x, y)
        return when (n and 3) {
            0 -> kernelCos(y[0], y[1])
            1 -> -kernelSin(y[0], y[1], 1)
            2 -> -kernelCos(y[0], y[1])
            else -> kernelSin(y[0], y[1], 1)
        }
    }

    private val ATANHI = doubleArrayOf(
        d(0x3FDDAC670561BB4FL), // atan(0.5)hi
        d(0x3FE921FB54442D18L), // atan(1.0)hi
        d(0x3FEF730BD281F69BL), // atan(1.5)hi
        d(0x3FF921FB54442D18L), // atan(inf)hi
    )
    private val ATANLO = doubleArrayOf(
        d(0x3C7A2B7F222F65E2L), // atan(0.5)lo
        d(0x3C81A62633145C07L), // atan(1.0)lo
        d(0x3C7007887AF0CBBDL), // atan(1.5)lo
        d(0x3C91A62633145C07L), // atan(inf)lo
    )
    private val AT = doubleArrayOf(
        d(0x3FD555555555550DL),
        u(0xBFC999999998EBC4UL),
        d(0x3FC24924920083FFL),
        u(0xBFBC71C6FE231671UL),
        d(0x3FB745CDC54C206EL),
        u(0xBFB3B0F2AF749A6DUL),
        d(0x3FB10D66A0D03D51L),
        u(0xBFADDE2D52DEFD9AUL),
        d(0x3FA97B4B24760DEBL),
        u(0xBFA2B4442C6A6C2FUL),
        d(0x3F90AD3AE322DA11L),
    )

    /** `Math.atan` of V8 (used by atan2). */
    fun atan(x0: Double): Double {
        var x = x0
        val hx = highWord(x)
        val ix = hx and 0x7FFFFFFF
        val id: Int
        if (ix >= 0x44100000) { // if |x| >= 2^66
            val low = lowWord(x)
            if (ix > 0x7FF00000 || (ix == 0x7FF00000 && low != 0)) return x + x // NaN
            return if (hx > 0) ATANHI[3] + ATANLO[3] else -ATANHI[3] - ATANLO[3]
        }
        if (ix < 0x3FDC0000) { // |x| < 0.4375
            if (ix < 0x3E400000) { // |x| < 2^-27
                if (1.0e300 + x > 1.0) return x // raise inexact
            }
            id = -1
        } else {
            x = abs(x)
            if (ix < 0x3FF30000) { // |x| < 1.1875
                if (ix < 0x3FE60000) { // 7/16 <=|x|<11/16
                    id = 0
                    x = (2.0 * x - 1.0) / (2.0 + x)
                } else { // 11/16<=|x|< 19/16
                    id = 1
                    x = (x - 1.0) / (x + 1.0)
                }
            } else {
                if (ix < 0x40038000) { // |x| < 2.4375
                    id = 2
                    x = (x - 1.5) / (1.0 + 1.5 * x)
                } else { // 2.4375 <= |x| < 2^66
                    id = 3
                    x = -1.0 / x
                }
            }
        }
        // end of argument reduction
        var z = x * x
        val w = z * z
        // break sum from i=0 to 10 aT[i]z**(i+1) into odd and even poly
        val s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))))
        val s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))))
        return if (id < 0) {
            x - x * (s1 + s2)
        } else {
            z = ATANHI[id] - ((x * (s1 + s2) - ATANLO[id]) - x)
            if (hx < 0) -z else z
        }
    }

    private const val TINY = 1.0e-300
    private val PI_O_4 = d(0x3FE921FB54442D18L)
    private val PI_O_2 = d(0x3FF921FB54442D18L)
    private val PI = d(0x400921FB54442D18L)
    private val PI_LO = d(0x3CA1A62633145C07L)

    /** `Math.atan2` of V8. */
    fun atan2(y: Double, x: Double): Double {
        val hx = highWord(x)
        val lx = lowWord(x)
        val ix = hx and 0x7FFFFFFF
        val hy = highWord(y)
        val ly = lowWord(y)
        val iy = hy and 0x7FFFFFFF
        if ((ix or ((lx or -lx) ushr 31)) > 0x7FF00000 || (iy or ((ly or -ly) ushr 31)) > 0x7FF00000) {
            return x + y // x or y is NaN
        }
        if (((hx - 0x3FF00000) or lx) == 0) return atan(y) // x=1.0
        var m = ((hy shr 31) and 1) or ((hx shr 30) and 2) // 2*sign(x)+sign(y)

        // when y = 0
        if ((iy or ly) == 0) {
            when (m) {
                0, 1 -> return y // atan(+-0,+anything)=+-0
                2 -> return PI + TINY // atan(+0,-anything) = pi
                3 -> return -PI - TINY // atan(-0,-anything) =-pi
            }
        }
        // when x = 0
        if ((ix or lx) == 0) return if (hy < 0) -PI_O_2 - TINY else PI_O_2 + TINY

        // when x is INF
        if (ix == 0x7FF00000) {
            if (iy == 0x7FF00000) {
                when (m) {
                    0 -> return PI_O_4 + TINY // atan(+INF,+INF)
                    1 -> return -PI_O_4 - TINY // atan(-INF,+INF)
                    2 -> return 3.0 * PI_O_4 + TINY // atan(+INF,-INF)
                    3 -> return -3.0 * PI_O_4 - TINY // atan(-INF,-INF)
                }
            } else {
                when (m) {
                    0 -> return ZERO // atan(+...,+INF)
                    1 -> return -ZERO // atan(-...,+INF)
                    2 -> return PI + TINY // atan(+...,-INF)
                    3 -> return -PI - TINY // atan(-...,-INF)
                }
            }
        }
        // when y is INF
        if (iy == 0x7FF00000) return if (hy < 0) -PI_O_2 - TINY else PI_O_2 + TINY

        // compute y/x
        val k = (iy - ix) shr 20
        val z: Double
        if (k > 60) { // |y/x| > 2**60
            z = PI_O_2 + 0.5 * PI_LO
            m = m and 1
        } else if (hx < 0 && k < -60) {
            z = 0.0 // 0 > |y|/x > -2**-60
        } else {
            z = atan(abs(y / x)) // safe to do y/x
        }
        return when (m) {
            0 -> z // atan(+,+)
            1 -> -z // atan(-,+)
            2 -> PI - (z - PI_LO) // atan(+,-)
            else -> (z - PI_LO) - PI // atan(-,-)
        }
    }
}
