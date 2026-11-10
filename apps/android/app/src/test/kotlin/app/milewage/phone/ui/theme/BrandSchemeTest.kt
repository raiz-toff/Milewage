package app.milewage.phone.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import com.materialkolor.dynamiccolor.ColorSpec.SpecVersion
import com.materialkolor.dynamiccolor.DynamicColor
import com.materialkolor.dynamiccolor.DynamicScheme
import com.materialkolor.dynamiccolor.MaterialDynamicColors
import com.materialkolor.hct.Hct
import com.materialkolor.scheme.SchemeContent
import com.materialkolor.scheme.SchemeFidelity
import com.materialkolor.scheme.SchemeTonalSpot
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Pins BrandColors to Google's material-color-utilities: the brand seed #FFC21F, the Fidelity
 * variant, the 2021 (Material 3 baseline) spec, standard contrast. The web generates its scheme
 * from the same seed with @material/material-color-utilities and the same settings.
 *
 * When this fails, the generated source is in app/build/brand-colors/BrandColors.kt: review the
 * change, then copy it over src/main/.../ui/theme/BrandColors.kt.
 */
/** A Compose colour role and the MCU dynamic colour that defines it. */
class Role(val name: String, val compose: (ColorScheme) -> Color, val mcu: DynamicColor)

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
        assertEquals(extendedColors(SEED, isDark = false), BrandColors.LightExtended, "light extended")
        assertEquals(extendedColors(SEED, isDark = true), BrandColors.DarkExtended, "dark extended")
    }

    /** The web writes its scheme to apps/web/src/theme/m3-scheme.json from the same seed: same colours. */
    @Test
    fun matchesTheWebScheme() {
        val file = File("../../web/src/theme/m3-scheme.json")
        if (!file.isFile) return // the web app is not checked out next to this one
        val web = Json.parseToJsonElement(file.readText()).jsonObject
        assertEquals("#FFC21F", web.getValue("seed").jsonPrimitive.content.uppercase())
        assertEquals("fidelity", web.getValue("variant").jsonPrimitive.content)
        for ((mode, scheme, extended) in listOf(
            Triple("light", BrandColors.Light, BrandColors.LightExtended),
            Triple("dark", BrandColors.Dark, BrandColors.DarkExtended),
        )) {
            val roles = web.getValue(mode).jsonObject.mapValues { it.value.jsonPrimitive.content.lowercase() }
            val ours = ROLES.associate { it.name to it.compose(scheme) } + mapOf(
                "earned" to extended.earned, "onEarned" to extended.onEarned,
                "earnedContainer" to extended.earnedContainer, "onEarnedContainer" to extended.onEarnedContainer,
                "spent" to extended.spent, "onSpent" to extended.onSpent,
                "spentContainer" to extended.spentContainer, "onSpentContainer" to extended.onSpentContainer,
            )
            for ((name, color) in ours) {
                val webValue = roles[name] ?: continue
                assertEquals(webValue, "#%06x".format(color.toArgb() and 0xFFFFFF), "$mode $name")
            }
        }
    }

    @Test
    fun brandYellowIsThePrimaryContainerInLight() {
        // Fidelity puts the seed itself in primaryContainer: the brand stays recognisably MileWage yellow.
        assertEquals(SEED, BrandColors.Light.primaryContainer.toArgb())
    }

    @Test
    fun textOnTheBrandRolesMeetsWcagAA() {
        for ((scheme, mode) in listOf(BrandColors.Light to "light", BrandColors.Dark to "dark")) {
            val pairs = listOf(
                "onPrimary/primary" to (scheme.onPrimary to scheme.primary),
                "onPrimaryContainer/primaryContainer" to (scheme.onPrimaryContainer to scheme.primaryContainer),
                "onSurface/surface" to (scheme.onSurface to scheme.surface),
                "onSurfaceVariant/surface" to (scheme.onSurfaceVariant to scheme.surface),
                "primary/surface" to (scheme.primary to scheme.surface),
            )
            for ((name, pair) in pairs) {
                val ratio = contrast(pair.first.toArgb(), pair.second.toArgb())
                assert(ratio >= 4.5) { "$mode $name contrast $ratio < 4.5" }
            }
        }
    }

    /** Prints the three candidate variants (run with --info to see them): how the choice was made. */
    @Test
    fun printCandidates() {
        for (variant in listOf("tonalSpot", "fidelity", "content")) {
            for (dark in listOf(false, true)) {
                val s = scheme(variant, dark)
                val c = MaterialDynamicColors()
                println(
                    "$variant ${if (dark) "dark" else "light"}: primary ${hex(c.primary.getArgb(s))} " +
                        "primaryContainer ${hex(c.primaryContainer.getArgb(s))} surface ${hex(c.surface.getArgb(s))} " +
                        "onPrimary/primary ${"%.2f".format(contrast(c.onPrimary.getArgb(s), c.primary.getArgb(s)))} " +
                        "primary/surface ${"%.2f".format(contrast(c.primary.getArgb(s), c.surface.getArgb(s)))}",
                )
            }
        }
    }

    private companion object {
        const val SEED: Int = 0xFFFFC21F.toInt()

        fun scheme(variant: String, isDark: Boolean): DynamicScheme {
            val hct = Hct.fromInt(SEED)
            return when (variant) {
                "tonalSpot" -> SchemeTonalSpot(hct, isDark, 0.0, SpecVersion.SPEC_2021)
                "content" -> SchemeContent(hct, isDark, 0.0, SpecVersion.SPEC_2021)
                else -> SchemeFidelity(hct, isDark, 0.0, SpecVersion.SPEC_2021)
            }
        }

        val MCU = MaterialDynamicColors()

        /** Every role Compose Material 3 1.4 has: name, the Compose getter, the MCU dynamic colour. */
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

        fun generatedRoles(isDark: Boolean): Map<String, String> {
            val s = scheme("fidelity", isDark)
            return ROLES.associate { it.name to hex(it.mcu.getArgb(s)) }
        }

        fun hex(argb: Int): String = "0x%08X".format(argb)

        fun color(c: Color): String = "Color(${hex(c.toArgb())})"

        fun generatedSource(): String = buildString {
            appendLine("package app.milewage.phone.ui.theme")
            appendLine()
            appendLine("import androidx.compose.material3.darkColorScheme")
            appendLine("import androidx.compose.material3.lightColorScheme")
            appendLine("import androidx.compose.ui.graphics.Color")
            appendLine()
            appendLine("// GENERATED by BrandSchemeTest from material-color-utilities; do not edit by hand.")
            appendLine("// Seed #FFC21F (Lane yellow), SchemeFidelity, spec 2021 (Material 3 baseline), contrast 0.")
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
                val e = extendedColors(SEED, isDark)
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

        /** WCAG 2 contrast ratio of two opaque colours. */
        fun contrast(a: Int, b: Int): Double {
            fun lum(argb: Int): Double {
                fun ch(v: Int): Double {
                    val c = v / 255.0
                    return if (c <= 0.03928) c / 12.92 else Math.pow((c + 0.055) / 1.055, 2.4)
                }
                return 0.2126 * ch(argb shr 16 and 0xFF) + 0.7152 * ch(argb shr 8 and 0xFF) + 0.0722 * ch(argb and 0xFF)
            }
            val (hi, lo) = listOf(lum(a), lum(b)).sortedDescending()
            return (hi + 0.05) / (lo + 0.05)
        }
    }
}
