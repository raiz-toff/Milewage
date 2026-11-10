package app.milewage.engine

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FdLibm against Node's own Math.sin, Math.cos and Math.atan2, bit for bit. The vectors come from
 * tools/export-math.ts: a committed sample always, the full set (900,000 calls) when generated.
 */
class FdLibmTest {
    private data class Outcome(val calls: Int, val mismatches: List<String>, val jvmDiffers: Int)

    private fun check(file: File): Outcome {
        var calls = 0
        var jvmDiffers = 0
        val bad = ArrayList<String>()
        fun same(a: Double, b: Double) = a.toRawBits() == b.toRawBits() || (a.isNaN() && b.isNaN())
        file.forEachLine { line ->
            if (line.isBlank()) return@forEachLine
            val p = line.split(' ')
            val got: Double
            val want: Double
            val jvm: Double
            when (p[0]) {
                "sin" -> {
                    val x = TestFiles.hexToDouble(p[1])
                    got = FdLibm.sin(x)
                    jvm = kotlin.math.sin(x)
                    want = TestFiles.hexToDouble(p[2])
                }
                "cos" -> {
                    val x = TestFiles.hexToDouble(p[1])
                    got = FdLibm.cos(x)
                    jvm = kotlin.math.cos(x)
                    want = TestFiles.hexToDouble(p[2])
                }
                "atan2" -> {
                    val y = TestFiles.hexToDouble(p[1])
                    val x = TestFiles.hexToDouble(p[2])
                    got = FdLibm.atan2(y, x)
                    jvm = kotlin.math.atan2(y, x)
                    want = TestFiles.hexToDouble(p[3])
                }
                else -> error("bad line $line")
            }
            calls++
            if (!same(got, want)) bad.add("$line -> ${TestFiles.doubleToHex(got)}")
            if (!same(jvm, want)) jvmDiffers++
        }
        return Outcome(calls, bad, jvmDiffers)
    }

    @Test
    fun committedSampleIsBitExact() {
        val r = check(TestFiles.resource("math-sample.txt"))
        assertTrue(r.calls > 3000)
        assertEquals(emptyList(), r.mismatches.take(20))
        println("FdLibm sample: ${r.calls} calls bit-exact with Node; kotlin.math differs on ${r.jvmDiffers}")
    }

    @Test
    fun fullSetIsBitExact() {
        val file = File(TestFiles.crosscheckDir, "math.txt")
        if (!file.isFile) {
            println("SKIPPED FdLibm full set: run tools/export-math.ts (engine README, Cross-check)")
            return
        }
        val r = check(file)
        assertEquals(emptyList(), r.mismatches.take(20), "${r.mismatches.size} of ${r.calls} differ")
        println("FdLibm full set: ${r.calls} calls bit-exact with Node; kotlin.math (JVM) differs on ${r.jvmDiffers}")
    }

    @Test
    fun onDeviceSelfCheckPassesHere() {
        assertEquals(emptyList(), engineSelfCheck())
        assertEquals(emptyList(), Engine.selfCheck())
    }

    @Test
    fun specialValues() {
        assertEquals(0.0.toRawBits(), FdLibm.sin(0.0).toRawBits())
        assertEquals((-0.0).toRawBits(), FdLibm.sin(-0.0).toRawBits())
        assertEquals(1.0, FdLibm.cos(0.0))
        assertTrue(FdLibm.sin(Double.POSITIVE_INFINITY).isNaN())
        assertTrue(FdLibm.cos(Double.NaN).isNaN())
        assertEquals(kotlin.math.PI / 2, FdLibm.atan2(1.0, 0.0))
        assertEquals(kotlin.math.PI, FdLibm.atan2(0.0, -1.0))
        assertEquals(-kotlin.math.PI, FdLibm.atan2(-0.0, -1.0))
    }
}
