package app.milewage.phone.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import com.materialkolor.dynamiccolor.ColorSpec.SpecVersion
import com.materialkolor.dynamiccolor.DynamicColor
import com.materialkolor.dynamiccolor.DynamicScheme
import com.materialkolor.dynamiccolor.MaterialDynamicColors
import com.materialkolor.dynamiccolor.Variant
import com.materialkolor.hct.Hct
import com.materialkolor.palettes.TonalPalette
import com.materialkolor.scheme.SchemeFidelity
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** A Compose colour role and the MCU dynamic colour that defines it. */
class Role(val name: String, val compose: (ColorScheme) -> Color, val mcu: DynamicColor)

/**
 * Pins BrandColors to the web's scheme, "Asphalt and lane" (apps/web/scripts/m3-theme.mjs, which
 * writes apps/web/src/theme/m3-scheme.json, the single source):
 *
 * 1. [recipeIsTheWebRecipe]: the recipe below (seed, variant, palettes, override table, money
 *    seeds and tones) equals the JSON's `palettes`, `overrides` and `customColors`.
 * 2. [brandSchemeIsTheGeneratedOne]: BrandColors is what that recipe gives with Google's
 *    material-color-utilities (materialkolor): a Fidelity DynamicScheme on the seed with the
 *    Asphalt-hue neutral, neutral-variant and secondary palettes, then the overrides.
 * 3. [matchesTheWebScheme]: every role the JSON has and Compose has is the same hex in both
 *    themes, the money colours included, except the roles in [ANDROID_ONLY], whose web value is
 *    pinned too, so a change on the web side brings the exception back for review.
 *
 * When this fails after a web change, bring RECIPE in line with the JSON; the generated source is
 * in app/build/brand-colors/BrandColors.kt: review it, then copy it over
 * src/main/.../ui/theme/BrandColors.kt.
 */
class BrandSchemeTest {
    @Test
    fun brandSchemeIsTheGeneratedOne() {
        val expected = generatedSource()
        File("build/brand-colors").mkdirs()
        File("build/brand-colors/BrandColors.kt").writeText(expected)
        val light = ROLES.associate { it.name to hex(it.compose(BrandColors.Light).toArgb()) }
        val dark = ROLES.associate { it.name to hex(it.compose(BrandColors.Dark).toArgb()) }
        assertEquals(generatedRoles(isDark = false), light, "light scheme")
        assertEquals(generatedRoles(isDark = true), dark, "dark scheme")
        assertEquals(extendedColors(isDark = false), BrandColors.LightExtended, "light extended")
        assertEquals(extendedColors(isDark = true), BrandColors.DarkExtended, "dark extended")
    }

    @Test
    fun recipeIsTheWebRecipe() {
        val web = webScheme()
        assertEquals(SEED_HEX, web.str("seed").uppercase(), "seed")
        assertEquals("fidelity", web.str("variant"), "variant")
        assertEquals("2021", web.str("specVersion"), "spec version")
        assertEquals(0.0, web.getValue("contrastLevel").jsonPrimitive.double, "contrast level")
        val palettes = web.obj("palettes").mapValues { (_, p) ->
            p.jsonObject.let { it.getValue("hue").jsonPrimitive.double to it.getValue("chroma").jsonPrimitive.double }
        }
        assertEquals(PALETTES, palettes, "palettes")
        val overrides = web.obj("overrides").mapValues { (_, o) ->
            fun side(mode: String) = o.jsonObject.obj(mode).let { it.str("palette") to it.getValue("tone").jsonPrimitive.int }
            side("light") to side("dark")
        }
        assertEquals(OVERRIDES, overrides, "overrides")
        val custom = web.obj("customColors")
        for ((name, seed, light, dark) in listOf(
            Money("earned", ExtendedSeeds.EARNED, ExtendedSeeds.EARNED_LIGHT, ExtendedSeeds.EARNED_DARK),
            Money("spent", ExtendedSeeds.SPENT, ExtendedSeeds.SPENT_LIGHT, ExtendedSeeds.SPENT_DARK),
        )) {
            val c = custom.obj(name)
            assertEquals("#%06X".format(seed and 0xFFFFFF), c.str("value").uppercase(), "$name seed")
            assertEquals(false, c.getValue("harmonized").jsonPrimitive.boolean, "$name harmonised")
            fun tones(mode: String) = c.obj("tones").obj(mode).let {
                ExtendedSeeds.Tones(it.int("color"), it.int("on"), it.int("container"), it.int("onContainer"))
            }
            assertEquals(light, tones("light"), "$name light tones")
            assertEquals(dark, tones("dark"), "$name dark tones")
        }
    }

    @Test
    fun matchesTheWebScheme() {
        val web = webScheme()
        for ((mode, scheme, extended) in listOf(
            Triple("light", BrandColors.Light, BrandColors.LightExtended),
            Triple("dark", BrandColors.Dark, BrandColors.DarkExtended),
        )) {
            val roles = web.obj(mode).mapValues { it.value.jsonPrimitive.content.lowercase() }
            val ours = ROLES.associate { it.name to it.compose(scheme) } + mapOf(
                "earned" to extended.earned, "onEarned" to extended.onEarned,
                "earnedContainer" to extended.earnedContainer, "onEarnedContainer" to extended.onEarnedContainer,
                "spent" to extended.spent, "onSpent" to extended.onSpent,
                "spentContainer" to extended.spentContainer, "onSpentContainer" to extended.onSpentContainer,
            )
            var compared = 0
            for ((name, color) in ours) {
                val webValue = roles[name]
                assertTrue(webValue != null, "$mode $name is missing from m3-scheme.json")
                val exception = ANDROID_ONLY[name]
                if (exception != null) {
                    val (webLight, webDark) = exception.webValues
                    assertEquals(if (mode == "light") webLight else webDark, webValue, "$mode $name: the web changed it; review the Android exception")
                    continue
                }
                assertEquals(webValue, css(color), "$mode $name")
                compared++
            }
            assertTrue(compared >= ROLES.size + 8 - ANDROID_ONLY.size, "compared $compared roles")
        }
    }

    /** The brand yellow is the primary container in both themes, and only there among the Material roles a screen paints. */
    @Test
    fun laneYellowIsOnlyThePrimaryContainer() {
        for (scheme in listOf(BrandColors.Light, BrandColors.Dark)) {
            assertEquals(SEED, scheme.primaryContainer.toArgb())
            val painted = listOf(
                scheme.primary, scheme.onPrimary, scheme.inversePrimary, scheme.secondary, scheme.secondaryContainer,
                scheme.background, scheme.surface, scheme.surfaceTint, scheme.surfaceContainerLowest, scheme.surfaceContainerLow,
                scheme.surfaceContainer, scheme.surfaceContainerHigh, scheme.surfaceContainerHighest, scheme.outline,
                scheme.outlineVariant, scheme.inverseSurface, scheme.onSurface, scheme.onSurfaceVariant,
            )
            for (c in painted) {
                val hct = Hct.fromInt(c.toArgb())
                assertTrue(hct.chroma < 10.0, "${css(c)} carries colour (chroma ${hct.chroma})")
            }
        }
    }

    private data class Money(val name: String, val seed: Int, val light: ExtendedSeeds.Tones, val dark: ExtendedSeeds.Tones)

    /** A role Android sets differently from the web, with the reason, its palette tones, and the web's values at the time. */
    class AndroidOnly(val why: String, val light: Pair<String, Int>, val dark: Pair<String, Int>, val webValues: Pair<String, String>)

    companion object {
        const val SEED_HEX = "#FFC21F"
        const val SEED: Int = 0xFFFFC21F.toInt()

        /** apps/web/scripts/m3-theme.mjs PALETTES: HCT hue and chroma. */
        val PALETTES: Map<String, Pair<Double, Double>> = mapOf(
            "neutral" to (243.0 to 4.0),
            "neutralVariant" to (243.0 to 8.0),
            "secondary" to (243.0 to 8.0),
        )

        /** apps/web/scripts/m3-theme.mjs OVERRIDES: role to (light palette and tone, dark palette and tone). */
        val OVERRIDES: Map<String, Pair<Pair<String, Int>, Pair<String, Int>>> = mapOf(
            "primary" to (("neutral" to 15) to ("neutral" to 90)),
            "onPrimary" to (("neutral" to 100) to ("neutral" to 10)),
            "surfaceTint" to (("neutral" to 15) to ("neutral" to 90)),
            "onPrimaryContainer" to (("neutral" to 6) to ("neutral" to 6)),
            "onSecondaryContainer" to (("secondary" to 10) to ("secondary" to 90)),
            "background" to (("neutral" to 95) to ("neutral" to 6)),
        )

        /**
         * The Android exceptions. The web has no snackbar and leaves inverse-primary as Fidelity
         * computes it: Lane yellow #f9bd17 in light and a gold #795900 in dark. Android's snackbar
         * draws its action in inversePrimary on inverseSurface, so the web's value would put the
         * yellow on a message (a new place for it) and a warm gold in dark. Android takes the
         * steel of the secondary palette instead: tone 80 on the dark snackbar of the light
         * theme, tone 40 on the light snackbar of the dark theme (contrast in ContrastTest).
         */
        val ANDROID_ONLY: Map<String, AndroidOnly> = mapOf(
            "inversePrimary" to AndroidOnly(
                why = "Snackbar action: steel, not yellow or gold",
                light = "secondary" to 80,
                dark = "secondary" to 40,
                webValues = "#f9bd17" to "#795900",
            ),
        )

        fun webScheme(): JsonObject {
            val file = File("../../web/src/theme/m3-scheme.json")
            assertTrue(file.isFile, "apps/web/src/theme/m3-scheme.json not found: the Android scheme is pinned to it")
            return Json.parseToJsonElement(file.readText()).jsonObject
        }

        private fun JsonObject.obj(key: String) = getValue(key).jsonObject

        private fun JsonObject.str(key: String) = getValue(key).jsonPrimitive.content

        private fun JsonObject.int(key: String) = getValue(key).jsonPrimitive.int

        val MCU = MaterialDynamicColors()

        /** Every role Compose Material 3 has: name, the Compose getter, the MCU dynamic colour. */
        val ROLES: List<Role> = listOf(
            Role("primary", { it.primary }, MCU.primary),
            Role("onPrimary", { it.onPrimary }, MCU.onPrimary),
            Role("primaryContainer", { it.primaryContainer }, MCU.primaryContainer),
            Role("onPrimaryContainer", { it.onPrimaryContainer }, MCU.onPrimaryContainer),
            Role("inversePrimary", { it.inversePrimary }, MCU.inversePrimary),
            Role("secondary", { it.secondary }, MCU.secondary),
            Role("onSecondary", { it.onSecondary }, MCU.onSecondary),
            Role("secondaryContainer", { it.secondaryContainer }, MCU.secondaryContainer),
            Role("onSecondaryContainer", { it.onSecondaryContainer }, MCU.onSecondaryContainer),
            Role("tertiary", { it.tertiary }, MCU.tertiary),
            Role("onTertiary", { it.onTertiary }, MCU.onTertiary),
            Role("tertiaryContainer", { it.tertiaryContainer }, MCU.tertiaryContainer),
            Role("onTertiaryContainer", { it.onTertiaryContainer }, MCU.onTertiaryContainer),
            Role("background", { it.background }, MCU.background),
            Role("onBackground", { it.onBackground }, MCU.onBackground),
            Role("surface", { it.surface }, MCU.surface),
            Role("onSurface", { it.onSurface }, MCU.onSurface),
            Role("surfaceVariant", { it.surfaceVariant }, MCU.surfaceVariant),
            Role("onSurfaceVariant", { it.onSurfaceVariant }, MCU.onSurfaceVariant),
            Role("surfaceTint", { it.surfaceTint }, MCU.surfaceTint),
            Role("inverseSurface", { it.inverseSurface }, MCU.inverseSurface),
            Role("inverseOnSurface", { it.inverseOnSurface }, MCU.inverseOnSurface),
            Role("error", { it.error }, MCU.error),
            Role("onError", { it.onError }, MCU.onError),
            Role("errorContainer", { it.errorContainer }, MCU.errorContainer),
            Role("onErrorContainer", { it.onErrorContainer }, MCU.onErrorContainer),
            Role("outline", { it.outline }, MCU.outline),
            Role("outlineVariant", { it.outlineVariant }, MCU.outlineVariant),
            Role("scrim", { it.scrim }, MCU.scrim),
            Role("surfaceBright", { it.surfaceBright }, MCU.surfaceBright),
            Role("surfaceContainer", { it.surfaceContainer }, MCU.surfaceContainer),
            Role("surfaceContainerHigh", { it.surfaceContainerHigh }, MCU.surfaceContainerHigh),
            Role("surfaceContainerHighest", { it.surfaceContainerHighest }, MCU.surfaceContainerHighest),
            Role("surfaceContainerLow", { it.surfaceContainerLow }, MCU.surfaceContainerLow),
            Role("surfaceContainerLowest", { it.surfaceContainerLowest }, MCU.surfaceContainerLowest),
            Role("surfaceDim", { it.surfaceDim }, MCU.surfaceDim),
            Role("primaryFixed", { it.primaryFixed }, MCU.primaryFixed),
            Role("primaryFixedDim", { it.primaryFixedDim }, MCU.primaryFixedDim),
            Role("onPrimaryFixed", { it.onPrimaryFixed }, MCU.onPrimaryFixed),
            Role("onPrimaryFixedVariant", { it.onPrimaryFixedVariant }, MCU.onPrimaryFixedVariant),
            Role("secondaryFixed", { it.secondaryFixed }, MCU.secondaryFixed),
            Role("secondaryFixedDim", { it.secondaryFixedDim }, MCU.secondaryFixedDim),
            Role("onSecondaryFixed", { it.onSecondaryFixed }, MCU.onSecondaryFixed),
            Role("onSecondaryFixedVariant", { it.onSecondaryFixedVariant }, MCU.onSecondaryFixedVariant),
            Role("tertiaryFixed", { it.tertiaryFixed }, MCU.tertiaryFixed),
            Role("tertiaryFixedDim", { it.tertiaryFixedDim }, MCU.tertiaryFixedDim),
            Role("onTertiaryFixed", { it.onTertiaryFixed }, MCU.onTertiaryFixed),
            Role("onTertiaryFixedVariant", { it.onTertiaryFixedVariant }, MCU.onTertiaryFixedVariant),
        )

        fun palette(name: String): TonalPalette {
            val (hue, chroma) = PALETTES.getValue(name)
            return TonalPalette.fromHueAndChroma(hue, chroma)
        }

        /** The web's `theme(dark)`: Fidelity on the seed, with the Asphalt-hue palettes. */
        fun scheme(isDark: Boolean): DynamicScheme {
            val fidelity = SchemeFidelity(Hct.fromInt(SEED), isDark, 0.0, SpecVersion.SPEC_2021)
            return DynamicScheme(
                Hct.fromInt(SEED),
                Variant.FIDELITY,
                isDark,
                0.0,
                DynamicScheme.Platform.PHONE,
                SpecVersion.SPEC_2021,
                fidelity.primaryPalette,
                palette("secondary"),
                fidelity.tertiaryPalette,
                palette("neutral"),
                palette("neutralVariant"),
                fidelity.errorPalette,
            )
        }

        fun generatedRoles(isDark: Boolean): Map<String, String> {
            val s = scheme(isDark)
            val named = mapOf("neutral" to s.neutralPalette, "secondary" to s.secondaryPalette, "primary" to s.primaryPalette)
            val roles = ROLES.associate { it.name to hex(it.mcu.getArgb(s)) }.toMutableMap()
            for ((role, sides) in OVERRIDES) {
                val (p, tone) = if (isDark) sides.second else sides.first
                roles[role] = hex(named.getValue(p).tone(tone))
            }
            for ((role, o) in ANDROID_ONLY) {
                val (p, tone) = if (isDark) o.dark else o.light
                roles[role] = hex(named.getValue(p).tone(tone))
            }
            return roles
        }

        fun hex(argb: Int): String = "0x%08X".format(argb)

        fun css(c: Color): String = "#%06x".format(c.toArgb() and 0xFFFFFF)

        fun color(c: Color): String = "Color(${hex(c.toArgb())})"

        fun generatedSource(): String = buildString {
            appendLine("package app.milewage.phone.ui.theme")
            appendLine()
            appendLine("import androidx.compose.material3.darkColorScheme")
            appendLine("import androidx.compose.material3.lightColorScheme")
            appendLine("import androidx.compose.ui.graphics.Color")
            appendLine()
            appendLine("// GENERATED by BrandSchemeTest; do not edit by hand. The web's scheme (apps/web/src/theme/m3-scheme.json):")
            appendLine("// Lane yellow #FFC21F on Asphalt-hue neutrals (hue 243, chroma 4 and 8), SchemeFidelity, spec 2021,")
            appendLine("// contrast 0, with the web's overrides; Android's own: inversePrimary (the snackbar action, BrandSchemeTest).")
            appendLine()
            appendLine("/** MileWage's brand colour schemes: the default, unless Settings > Use wallpaper colours is on. */")
            appendLine("object BrandColors {")
            for ((label, isDark) in listOf("Light" to false, "Dark" to true)) {
                val roles = generatedRoles(isDark)
                appendLine("    val $label = ${if (isDark) "darkColorScheme" else "lightColorScheme"}(")
                for ((name, value) in roles) appendLine("        $name = Color($value),")
                appendLine("    )")
                appendLine()
            }
            for ((label, isDark) in listOf("LightExtended" to false, "DarkExtended" to true)) {
                val e = extendedColors(isDark)
                appendLine("    val $label = ExtendedColors(")
                appendLine("        earned = ${color(e.earned)},")
                appendLine("        onEarned = ${color(e.onEarned)},")
                appendLine("        earnedContainer = ${color(e.earnedContainer)},")
                appendLine("        onEarnedContainer = ${color(e.onEarnedContainer)},")
                appendLine("        spent = ${color(e.spent)},")
                appendLine("        onSpent = ${color(e.onSpent)},")
                appendLine("        spentContainer = ${color(e.spentContainer)},")
                appendLine("        onSpentContainer = ${color(e.onSpentContainer)},")
                appendLine("    )")
                if (!isDark) appendLine()
            }
            appendLine("}")
        }
    }
}
