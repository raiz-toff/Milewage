package app.milewage.engine

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull
import java.io.File

/** Files the tests read: the TypeScript engine's fixtures by relative path, and this module's resources. */
object TestFiles {
    /** Gradle runs tests from the module directory, apps/android/engine. */
    val repoRoot: File = File("../../..").canonicalFile

    val goldenJson = File(repoRoot, "packages/track-engine/test/fixtures/golden.json")
    val goldenShiftJson = File(repoRoot, "packages/track-engine/test/fixtures/golden-shift.json")
    val phoneFixturesJson = File(repoRoot, "apps/phone/src/conformance/fixtures.json")

    /** The large, generated, gitignored cross-check files (README "Cross-check"). */
    val crosscheckDir = File("build/crosscheck")

    fun resource(name: String): File = File("src/test/resources/$name")

    /** Strict: an unknown or misspelt field fails, so the wire names are checked too. */
    val json = Json { ignoreUnknownKeys = false }

    /** A parsed JSON tree as the engine's canonical value; numbers must be integers. */
    fun toCanonical(e: JsonElement): CanonicalValue =
        when (e) {
            is JsonNull -> CanonicalValue.Null
            is JsonPrimitive -> when {
                e.isString -> CanonicalValue.Str(e.content)
                e.booleanOrNull != null -> CanonicalValue.Bool(e.booleanOrNull!!)
                else -> CanonicalValue.Num(e.longOrNull ?: error("not an integer: ${e.content}"))
            }
            is JsonArray -> CanonicalValue.Arr(e.map(::toCanonical))
            is JsonObject -> CanonicalValue.Obj(e.mapValues { toCanonical(it.value) })
        }

    fun hexToDouble(hex: String): Double = Double.fromBits(java.lang.Long.parseUnsignedLong(hex, 16))

    fun doubleToHex(x: Double): String = x.toRawBits().toULong().toString(16).padStart(16, '0')

    /** Index of the first differing character and an excerpt, or null when equal. */
    fun firstDiff(got: String, want: String): String? {
        if (got == want) return null
        var i = 0
        while (i < got.length && i < want.length && got[i] == want[i]) i++
        val from = maxOf(0, i - 40)
        return "at $i: got …${got.substring(from, minOf(got.length, i + 60))} | want …${want.substring(from, minOf(want.length, i + 60))}"
    }
}
