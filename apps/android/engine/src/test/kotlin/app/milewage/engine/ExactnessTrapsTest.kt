package app.milewage.engine

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * One test per place where JavaScript and Kotlin differ (README "Exactness"). The expected values
 * come from the TypeScript engine on Node (tools/export-traps.ts -> trap-vectors.json).
 */
class ExactnessTrapsTest {
    private val v = TestFiles.json.parseToJsonElement(TestFiles.resource("trap-vectors.json").readText()).jsonObject

    private fun units(e: JsonElement): String = e.jsonArray.map { it.jsonPrimitive.int.toChar() }.toCharArray().concatToString()

    private fun fix(e: JsonElement): Fix = TestFiles.json.decodeFromJsonElement(Fix.serializer(), e)

    @Test
    fun roundHalfUpIsFloorOfXPlusHalfNotKotlinRound() {
        for (c in v.getValue("roundHalfUp").jsonArray) {
            val x = TestFiles.hexToDouble(c.jsonObject.getValue("x").jsonPrimitive.content)
            assertEquals(c.jsonObject.getValue("r").jsonPrimitive.long, roundHalfUp(x), "roundHalfUp($x)")
        }
        // The trap: kotlin.math.round rounds halves to even, Math.floor(x + 0.5) rounds them up.
        assertEquals(2.0, kotlin.math.round(2.5))
        assertEquals(3, roundHalfUp(2.5))
        assertEquals(-2, roundHalfUp(-2.5))
    }

    @Test
    fun divRoundFloorsLikeMathFloorOnNegatives() {
        for (c in v.getValue("divRound").jsonArray) {
            val o = c.jsonObject
            val num = o.getValue("num").jsonPrimitive.long
            val den = o.getValue("den").jsonPrimitive.long
            assertEquals(o.getValue("r").jsonPrimitive.long, divRound(num, den), "divRound($num, $den)")
            assertEquals(o.getValue("m").jsonPrimitive.long, dmToM(num), "dmToM($num)")
        }
        // The trap: Kotlin's `/` truncates toward zero.
        assertEquals(-1, (2 * -16L + 10) / 20)
        assertEquals(-2, divRound(-16, 10))
        assertEquals(-2, (-1500L).floorDiv(1000L)) // Math.floor(-1500 / 1000), as gaps.ts and stops.ts use it
    }

    @Test
    fun compareFixesDoesNotOverflowWhereJavaScriptSubtracts() {
        for (c in v.getValue("compareFixes").jsonArray) {
            val o = c.jsonObject
            val a = fix(o.getValue("a"))
            val b = fix(o.getValue("b"))
            assertEquals(o.getValue("sign").jsonPrimitive.int, compareFixes(a, b).coerceIn(-1, 1), "$a vs $b")
        }
        // The trap: an Int subtraction of two longitudes wraps around.
        val lons = intArrayOf(-1800000000, 1800000000)
        assertTrue(lons[0] - lons[1] > 0)
    }

    @Test
    fun minMoveIsComputedInLong() {
        for (c in v.getValue("minMoveDm").jsonArray) {
            val o = c.jsonObject
            assertEquals(o.getValue("dm").jsonPrimitive.long, minMoveDm(fix(o.getValue("a")), fix(o.getValue("b"))))
        }
    }

    @Test
    fun jsonStringEscapingIsJsonStringify() {
        for (c in v.getValue("strings").jsonArray) {
            val o = c.jsonObject
            val s = units(o.getValue("units"))
            val sb = StringBuilder()
            jsonString(sb, s)
            assertEquals(units(o.getValue("json")), sb.toString(), "JSON.stringify of ${s.map { it.code }}")
        }
    }

    @Test
    fun fnvHashesUtf16CodeUnitsLowByteFirst() {
        for (c in v.getValue("strings").jsonArray) {
            val o = c.jsonObject
            val s = units(o.getValue("units"))
            assertEquals(o.getValue("fnv").jsonPrimitive.content, fnv1a64Hex(s), "fnv of ${s.map { it.code }}")
        }
        // FNV-1a 64 reference values (the TypeScript's two-half arithmetic is the real thing).
        assertEquals("cbf29ce484222325", fnv1a64Hex(""))
        assertEquals("af63dc4c8601ec8c", fnv1a64Hex("a"))
    }

    @Test
    fun canonicalInputTextSortsByStringsAndPrintsIntegersLikeJavaScript() {
        val input = TestFiles.json.decodeFromJsonElement(ShiftInput.serializer(), v.getValue("digestInput"))
        val normalized = normalize(input.fixes, input.startedAt, input.endedAt)
        val want = units(v.getValue("digestText"))
        assertEquals(want, canonicalInputText(input, normalized))
        assertEquals(fnv1a64Hex(want), inputDigest(input, normalized))
    }

    @Test
    fun routeSimplificationAcrossTheAntimeridianAndPoles() {
        val points = ListSerializer(RoutePoint.serializer())
        for (c in v.getValue("routes").jsonArray) {
            val o = c.jsonObject
            val input = TestFiles.json.decodeFromJsonElement(points, o.getValue("points"))
            assertEquals(TestFiles.json.decodeFromJsonElement(points, o.getValue("simplified")), simplifyRoute(input))
            assertEquals(TestFiles.json.decodeFromJsonElement(points, o.getValue("simplified5m")), simplifyRoute(input, 50))
        }
    }

    @Test
    fun flagOrderIsUtf16CodeUnitOrderOfTheCodeStrings() {
        val flags = TestFiles.json.decodeFromJsonElement(ListSerializer(Flag.serializer()), v.getValue("flags"))
        val sorted = sortFlags(flags)
        assertEquals(v.getValue("sortedFlags").jsonPrimitive.content, canonicalJson(CanonicalValue.Arr(sorted.map { it.toCanonical() })))
        // The traps: enum order is not string order, and code point order is not code unit order.
        assertTrue(FlagCode.GAP_COUNTED.ordinal < FlagCode.CLOCK_SKEW.ordinal)
        assertTrue(cmp("clock_skew", "gap_counted") < 0)
        assertTrue("😀".codePointAt(0) > "～".codePointAt(0))
        assertTrue(cmp("😀", "～") < 0)
    }

    @Test
    fun labelsSortByRoleStringNotEnumOrder() {
        val stop = DetectedStop("s:1:stop", 1, 200_000, 199, 0, 0, Confidence.MEDIUM, startGuarded = false)
        val labels = listOf(StopLabelInput("s:1:stop", LabelRole.PICKUP), StopLabelInput("s:1:stop", LabelRole.DROPOFF))
        // Sorted ("dropoff", "pickup"): the later one, pickup, wins. By ordinal dropoff would.
        assertEquals(StopRole.PICKUP, estimateRoles(listOf(stop), labels).stops.single().role)
        assertEquals(StopRole.PICKUP, estimateRoles(listOf(stop), labels.reversed()).stops.single().role)
        assertTrue(LabelRole.PICKUP.ordinal < LabelRole.DROPOFF.ordinal)
    }

    @Test
    fun orphanedLabelsKeepJavaScriptMapInsertionOrder() {
        val labels = listOf("c", "a", "b", "a").map { StopLabelInput(it, LabelRole.OTHER) }
        assertEquals(listOf("a", "b", "c"), estimateRoles(emptyList(), labels).flags.map { it.detail })
    }

    @Test
    fun sortIsStableLikeV8() {
        val speeds = v.getValue("stableSpeeds").jsonArray.map { it.jsonPrimitive.longOrNull?.toInt() }
        val f = { seq: Long, at: Long, speed: Int -> Fix(seq, at, 0, 0, 5, speedDmps = speed) }
        val got = normalize(listOf(f(7, 1000, 1), f(7, 1000, 2), f(3, 999, 3)), 0, 2000).map { it.speedDmps }
        assertEquals(speeds, got)
    }

    @Test
    fun canonicalJsonRefusesUnsafeIntegers() {
        assertEquals("9007199254740991", canonicalJson(CanonicalValue.Num(MAX_SAFE_INTEGER)))
        assertEquals("-9007199254740991", canonicalJson(CanonicalValue.Num(-MAX_SAFE_INTEGER)))
        assertFailsWith<IllegalArgumentException> { canonicalJson(CanonicalValue.Num(MAX_SAFE_INTEGER + 1)) }
        // Keys sorted by code unit, absent members omitted.
        val obj = CanonicalValue.Obj(mapOf("b" to CanonicalValue.Num(1), "B" to CanonicalValue.Null, "a" to CanonicalValue.Arr(emptyList())))
        assertEquals("""{"B":null,"a":[],"b":1}""", canonicalJson(obj))
        assertEquals("""{"code":"calc_mismatch"}""", canonicalJson(Flag(FlagCode.CALC_MISMATCH).toCanonical()))
    }

    @Test
    fun wireNamesAreTheTypeScriptNames() {
        val all: List<WireEnum> = FlagCode.entries + TripKind.entries + TripState.entries + LabelRole.entries +
            StopRole.entries + EstRole.entries + Confidence.entries + Segmenter.entries
        for (e in all) {
            val encoded = TestFiles.json.encodeToString(
                kotlinx.serialization.serializer(e::class.java),
                e,
            )
            assertEquals("\"${e.wire}\"", encoded)
        }
        val trip = Trip("k", TripKind.PERSONAL, TripState.ACTIVE, 1, 2, 3, 4, 5, 6, 7, "p")
        assertEquals(
            canonicalJson(trip.toCanonical()),
            canonicalJson(TestFiles.toCanonical(TestFiles.json.parseToJsonElement(TestFiles.json.encodeToString(Trip.serializer(), trip)))),
        )
    }
}
