package app.milewage.engine

import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Random shifts from tools/crosscheck.ts, run through the Kotlin engine and compared with what
 * Node produced: the canonical JSON of processShift byte for byte, the live accumulator's total,
 * lastFixEnd and measureDistance's figures. The 100-shift sample is committed; the large run
 * (2,000 shifts by default) is generated into build/crosscheck and checked when present.
 */
class CrossCheckTest {
    private data class Outcome(val shifts: Int, val fixes: Int, val differences: List<String>)

    private fun check(file: File): Outcome {
        var shifts = 0
        var fixes = 0
        val bad = ArrayList<String>()
        file.bufferedReader().useLines { lines ->
            val it = lines.iterator()
            val header = TestFiles.json.parseToJsonElement(it.next()).jsonObject
            assertEquals(ALGORITHM_VERSION, header.getValue("algorithmVersion").jsonPrimitive.int, "regenerate ${file.name}")
            for (line in it) {
                if (line.isBlank()) continue
                val case = TestFiles.json.parseToJsonElement(line).jsonObject
                val name = case.getValue("name").jsonPrimitive.content
                val input = TestFiles.json.decodeFromJsonElement(ShiftInput.serializer(), case.getValue("input"))
                shifts++
                fixes += input.fixes.size
                TestFiles.firstDiff(canonicalJson(processShift(input)), case.getValue("expected").jsonPrimitive.content)
                    ?.let { d -> bad.add("$name processShift $d") }

                val live = createLiveAccumulator(input.startedAt)
                input.fixes.forEach(live::push)
                val liveWant = case.getValue("liveM").jsonPrimitive.long
                if (live.runningTotalM() != liveWant) bad.add("$name live ${live.runningTotalM()} != $liveWant")

                val endWant = case.getValue("lastFixEnd").jsonPrimitive.longOrNull
                val end = lastFixEnd(input.fixes, input.startedAt)
                if (end != endWant) bad.add("$name lastFixEnd $end != $endWant")

                val m = measureDistance(input.fixes, input.startedAt, input.endedAt)
                val got = mapOf(
                    "distanceM" to m.distanceM,
                    "accepted" to m.accepted.size.toLong(),
                    "segments" to m.segments.size.toLong(),
                    "spikes" to m.spikes.size.toLong(),
                    "non_positive_dt" to m.stats.nonPositiveDt,
                    "speed_spike" to m.stats.speedSpike,
                    "within_gate" to m.stats.withinGate,
                )
                val want = case.getValue("measure").jsonObject.mapValues { e -> e.value.jsonPrimitive.long }
                if (got != want) bad.add("$name measureDistance $got != $want")
            }
        }
        return Outcome(shifts, fixes, bad)
    }

    @Test
    fun committedSample() {
        val r = check(TestFiles.resource("crosscheck-sample.jsonl"))
        println("Cross-check sample: ${r.shifts} shifts, ${r.fixes} fixes, ${r.differences.size} differences")
        assertEquals(100, r.shifts)
        assertEquals(emptyList(), r.differences.take(10))
    }

    @Test
    fun generatedRun() {
        val file = File(TestFiles.crosscheckDir, "shifts.jsonl")
        if (!file.isFile) {
            println("SKIPPED cross-check run: run tools/crosscheck.ts (engine README, Cross-check)")
            return
        }
        val r = check(file)
        println("Cross-check run: ${r.shifts} shifts, ${r.fixes} fixes, ${r.differences.size} differences")
        assertTrue(r.shifts > 0)
        assertEquals(emptyList(), r.differences.take(10), "${r.differences.size} differences")
    }
}
