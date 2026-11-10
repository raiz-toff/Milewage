package app.milewage.engine

import java.io.File
import kotlin.math.PI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * haversineDm against Node on the pairs of tools/export-math.ts: the raw double before rounding
 * must have the same 64 bits, and the decimetres must be equal. The committed sample (3,000
 * pairs) always runs; the full set (250,000 pairs over short hops, sub-metre, city, long,
 * high-latitude, antimeridian, equator and near-antipodal pairs) when generated.
 */
class HaversineCrossCheckTest {
    private data class Outcome(
        val pairs: Int,
        val rawMismatch: List<String>,
        val dmMismatch: Int,
        val jvmRawDiffers: Int,
        val jvmDmDiffers: Int,
        val jvmDmExamples: List<String>,
    )

    /** The same formula on kotlin.math (the JVM's sin/cos/atan2): what a naive port would do. */
    private fun naiveRawDm(aLat: Int, aLon: Int, bLat: Int, bLon: Int): Double {
        val rad = PI / 180
        val lat1 = e7ToDeg(aLat) * rad
        val lat2 = e7ToDeg(bLat) * rad
        val dLat = lat2 - lat1
        val dLon = (e7ToDeg(bLon) - e7ToDeg(aLon)) * rad
        val s1 = kotlin.math.sin(dLat / 2)
        val s2 = kotlin.math.sin(dLon / 2)
        val a = s1 * s1 + kotlin.math.cos(lat1) * kotlin.math.cos(lat2) * s2 * s2
        val c = 2 * kotlin.math.atan2(kotlin.math.sqrt(a), kotlin.math.sqrt(1 - a))
        return EARTH_RADIUS_M * c * 10
    }

    private fun check(file: File): Outcome {
        var pairs = 0
        var dmBad = 0
        var jvmRaw = 0
        var jvmDm = 0
        val bad = ArrayList<String>()
        val jvmExamples = ArrayList<String>()
        file.forEachLine { line ->
            if (line.isBlank() || line.startsWith("#")) return@forEachLine
            val p = line.split(',')
            val (a, b, c, d) = p.take(4).map { it.toInt() }
            val wantRaw = p[4]
            val wantDm = p[5].toLong()
            val raw = haversineRawDm(a, b, c, d)
            pairs++
            if (TestFiles.doubleToHex(raw) != wantRaw) bad.add("$line -> ${TestFiles.doubleToHex(raw)}")
            if (haversineDm(a, b, c, d) != wantDm) dmBad++
            val naive = naiveRawDm(a, b, c, d)
            if (TestFiles.doubleToHex(naive) != wantRaw) jvmRaw++
            if (roundHalfUp(naive) != wantDm) {
                jvmDm++
                if (jvmExamples.size < 10) jvmExamples.add("$line kotlin.math gives ${roundHalfUp(naive)} (raw $naive)")
            }
        }
        return Outcome(pairs, bad, dmBad, jvmRaw, jvmDm, jvmExamples)
    }

    private fun report(label: String, r: Outcome) {
        println(
            "Haversine $label: ${r.pairs} pairs, raw double bit-exact with Node on ${r.pairs - r.rawMismatch.size}, " +
                "decimetres equal on ${r.pairs - r.dmMismatch}; kotlin.math (JVM) would differ in the raw double on " +
                "${r.jvmRawDiffers} and in decimetres on ${r.jvmDmDiffers}",
        )
        r.jvmDmExamples.forEach { println("  $it") }
    }

    @Test
    fun committedSample() {
        val r = check(TestFiles.resource("haversine-sample.csv"))
        report("sample", r)
        assertTrue(r.pairs >= 3000)
        assertEquals(emptyList(), r.rawMismatch.take(20))
        assertEquals(0, r.dmMismatch)
    }

    @Test
    fun fullSet() {
        val file = File(TestFiles.crosscheckDir, "haversine.csv")
        if (!file.isFile) {
            println("SKIPPED haversine full set: run tools/export-math.ts (engine README, Cross-check)")
            return
        }
        val r = check(file)
        report("full set", r)
        assertTrue(r.pairs >= 200_000)
        assertEquals(emptyList(), r.rawMismatch.take(20), "${r.rawMismatch.size} raw mismatches")
        assertEquals(0, r.dmMismatch)
    }

    @Test
    fun knownDistances() {
        assertEquals(0, haversineDm(436500000, -793800000, 436500000, -793800000))
        // One E7 unit of latitude is 1.1 cm: 0 dm. 1e-5 degree is 1.1 m: 11 dm.
        assertEquals(0, haversineDm(436500000, -793800000, 436500001, -793800000))
        assertEquals(11, haversineDm(436500000, -793800000, 436500100, -793800000))
        // Pole to pole is half the circumference.
        assertEquals(200150868, haversineDm(900000000, 0, -900000000, 0))
    }
}
