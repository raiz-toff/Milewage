package app.milewage.phone.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import com.materialkolor.blend.Blend
import com.materialkolor.palettes.TonalPalette

/**
 * MileWage's two colours beyond the Material roles. Green is money in and nothing else; red-orange is
 * money out and nothing else (destructive actions use Material's `error`). Each comes with a container pair, like the Material roles.
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

/** The brand values the extended colours start from (design skill: Earned #34D399, Spent #FF6B5E). */
object ExtendedSeeds {
    const val EARNED: Int = 0xFF34D399.toInt()
    const val SPENT: Int = 0xFFFF6B5E.toInt()
}

/**
 * Material's custom-colour recipe (as Material Theme Builder does it): the brand colour's hue is
 * harmonised toward the scheme's source colour (at most 15 degrees, so green stays green), then the
 * roles are tones of that hue: light 40/100/90/10, dark 80/20/30/90.
 */
fun extendedColors(sourceArgb: Int, isDark: Boolean): ExtendedColors {
    fun roles(seed: Int): List<Color> {
        val palette = TonalPalette.fromInt(Blend.harmonize(seed, sourceArgb))
        val tones = if (isDark) listOf(80, 20, 30, 90) else listOf(40, 100, 90, 10)
        return tones.map { Color(palette.tone(it)) }
    }
    val earned = roles(ExtendedSeeds.EARNED)
    val spent = roles(ExtendedSeeds.SPENT)
    return ExtendedColors(earned[0], earned[1], earned[2], earned[3], spent[0], spent[1], spent[2], spent[3])
}

val LocalExtendedColors = staticCompositionLocalOf { BrandColors.LightExtended }
