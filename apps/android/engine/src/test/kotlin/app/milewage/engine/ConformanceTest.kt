package app.milewage.engine

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The TypeScript engine's own fixture files, read in place (README rule 4):
 * - packages/track-engine/conformance/fixtures.json: the golden inputs and Node's canonical JSON
 *   of processShift for each (`npm run conformance:fixtures -w @milewage/track-engine` writes it;
 *   `npm test` fails when it is stale);
 * - packages/track-engine/test/fixtures/golden-shift.json: the committed processShift results
 *   and their ledger digest;
 * - packages/track-engine/test/fixtures/golden.json: the stage 1-3 results of the rides and
 *   their ledger digest.
 */
class ConformanceTest {
    private val fixtures: JsonObject = TestFiles.json.parseToJsonElement(TestFiles.conformanceFixturesJson.readText()).jsonObject
    private val inputs: Map<String, ShiftInput> =
        fixtures.getValue("inputs").jsonObject.mapValues { TestFiles.json.decodeFromJsonElement(ShiftInput.serializer(), it.value) }

    private fun sha256(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    @Test
    fun conformanceFixturesAreByteIdentical() {
        assertEquals(ALGORITHM_VERSION, fixtures.getValue("algorithmVersion").jsonPrimitive.int)
        val expected = fixtures.getValue("expected").jsonObject
        assertEquals(expected.keys, inputs.keys)
        assertTrue(inputs.size >= 15)
        val bad = inputs.keys.sorted().mapNotNull { name ->
            val got = canonicalJson(processShift(inputs.getValue(name)))
            TestFiles.firstDiff(got, expected.getValue(name).jsonPrimitive.content)?.let { "$name $it" }
        }
        assertEquals(emptyList(), bad)
    }

    @Test
    fun goldenShiftResultsAndLedger() {
        val golden = TestFiles.json.parseToJsonElement(TestFiles.goldenShiftJson.readText()).jsonObject
        val results = golden.getValue("results").jsonObject
        assertEquals(results.keys, inputs.keys)
        val mine = LinkedHashMap<String, CanonicalValue>()
        for (name in results.keys.sorted()) {
            val got = processShift(inputs.getValue(name))
            mine[name] = got.toCanonical()
            val want = canonicalJson(TestFiles.toCanonical(results.getValue(name)))
            assertEquals(null, TestFiles.firstDiff(canonicalJson(got), want), name)
        }
        // The ledger is sha256 of canonicalJson(all results): the Kotlin bytes hash to the committed entry.
        val ledger = golden.getValue("ledger").jsonObject.getValue(ALGORITHM_VERSION.toString()).jsonPrimitive.content
        assertEquals(ledger, sha256(canonicalJson(CanonicalValue.Obj(mine))))
    }

    @Test
    fun goldenRideStagesAndLedger() {
        val golden = TestFiles.json.parseToJsonElement(TestFiles.goldenJson.readText()).jsonObject
        val rides = golden.getValue("rides").jsonObject
        assertEquals(listOf("straight", "grid", "loop", "stop_and_go"), rides.keys.toList())
        // JSON.stringify(rides) in the TypeScript's insertion order (test/support/golden.ts runStages).
        val text = rides.keys.joinToString(",", "{", "}") { name ->
            val input = inputs.getValue("ride_$name")
            val g = measureDistance(input.fixes, input.startedAt, input.endedAt)
            val normalized = normalize(input.fixes, input.startedAt, input.endedAt)
            val low = normalized.size - qualify(normalized).size
            "\"$name\":{\"algorithmVersion\":$ALGORITHM_VERSION,\"totals\":{\"totalM\":${g.distanceM}}," +
                "\"stats\":{\"fixes_in\":${input.fixes.size},\"fixes_used\":${g.accepted.size},\"low_accuracy\":$low," +
                "\"non_positive_dt\":${g.stats.nonPositiveDt},\"speed_spike\":${g.stats.speedSpike},\"within_gate\":${g.stats.withinGate}}}"
        }
        assertEquals(rides.toString(), text)
        val ledger = golden.getValue("ledger").jsonObject.getValue(ALGORITHM_VERSION.toString()).jsonPrimitive.content
        assertEquals(ledger, sha256(text))
    }

    @Test
    fun liveAccumulatorMatchesTheBatchTotalOnInOrderRides() {
        for (name in inputs.keys.filter { it.startsWith("ride_") }) {
            val input = inputs.getValue(name)
            val live = createLiveAccumulator(input.startedAt)
            input.fixes.forEach(live::push)
            assertEquals(measureDistance(input.fixes, input.startedAt, input.endedAt).distanceM, live.runningTotalM(), name)
        }
    }
}
