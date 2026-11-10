package app.milewage.phone.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import com.materialkolor.blend.Blend
import com.materialkolor.palettes.TonalPalette

/**
 * MileWage's two colours beyond the Material roles. Green is money in and nothing else; orange is
 * money out and nothing else (destructive actions use Material's `error`). Each comes with a
 * container pair, like the Material roles.
 */
@Immutable
data class ExtendedColors(
    val earned: Color,
    val onEarned: Color,
    val earnedContainer: Color,
    val onEarnedContainer: Color,
    val spent: Color,
    val onSpent: Color,
    val spentContainer: Color,
    val onSpentContainer: Color,
)

/**
 * The money colours as the web builds them (`CUSTOM` in apps/web/scripts/m3-theme.mjs, and
 * `customColors` in m3-scheme.json): a seed and the tone of each role per theme.
 */
object ExtendedSeeds {
    /** Earned, a clean green. */
    const val EARNED: Int = 0xFF34D399.toInt()

    /** Spent, an orange at hue 47, held apart from `error`'s red. */
    const val SPENT: Int = 0xFFEA6A0A.toInt()

    /** Tones of colour, on-colour, container, on-container. */
    data class Tones(val color: Int, val on: Int, val container: Int, val onContainer: Int)

    val EARNED_LIGHT = Tones(40, 100, 90, 10)
    val EARNED_DARK = Tones(70, 10, 30, 90)
    val SPENT_LIGHT = Tones(44, 100, 90, 10)
    val SPENT_DARK = Tones(70, 10, 30, 90)
}

/**
 * Material's custom-colour recipe: the roles are tones of the seed's palette (the tones above,
 * the web's). The brand scheme does not harmonise them, so earned stays green and spent orange.
 * With wallpaper colours on, [harmonizeWith] is the wallpaper's primary colour and each seed's hue
 * is moved toward it (at most 15 degrees, so green stays green), as Material Theme Builder does.
 */
fun extendedColors(isDark: Boolean, harmonizeWith: Int? = null): ExtendedColors {
    fun roles(seed: Int, tones: ExtendedSeeds.Tones): List<Color> {
        val palette = TonalPalette.fromInt(if (harmonizeWith != null) Blend.harmonize(seed, harmonizeWith) else seed)
        return listOf(tones.color, tones.on, tones.container, tones.onContainer).map { Color(palette.tone(it)) }
    }
    val earned = roles(ExtendedSeeds.EARNED, if (isDark) ExtendedSeeds.EARNED_DARK else ExtendedSeeds.EARNED_LIGHT)
    val spent = roles(ExtendedSeeds.SPENT, if (isDark) ExtendedSeeds.SPENT_DARK else ExtendedSeeds.SPENT_LIGHT)
    return ExtendedColors(earned[0], earned[1], earned[2], earned[3], spent[0], spent[1], spent[2], spent[3])
}

val LocalExtendedColors = staticCompositionLocalOf { BrandColors.LightExtended }
