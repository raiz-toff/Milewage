package app.milewage.phone.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext

/** Material 3's type scale on the system font (Roboto on most phones). No bundled font. */
val MileWageTypography = Typography()

/** Material 3's shape scale: extra small 4, small 8, medium 12, large 16, extra large 28 dp. */
val MileWageShapes = Shapes()

/** Whether the phone can give its wallpaper colours (Material You, Android 12 and later). */
val wallpaperColoursAvailable: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

/**
 * The surface model (design system, tokens.md), the same levels as the web's `bg-background`,
 * `bg-card`, `bg-muted` and `bg-popover`. Light and dark build depth differently, so a screen asks
 * for a level and never branches on the theme itself:
 *
 * - [page]: the screen, the top bar, the bottom bar. `background`: a cool grey in light, Asphalt in dark.
 * - [card]: a card, a group of rows, a stat tile. White (`surfaceContainerLowest`) in light,
 *   `surfaceContainer` in dark. No border, no shadow, no tint: it reads by lightness.
 * - [fill]: a fill on a card (a chip of colour, a tile inside a card). `surfaceContainerHigh` / `Highest`.
 * - [popover]: dialogs, menus, sheets. White in light, `surfaceContainerHigh` in dark.
 * - [road]: the asphalt under a lane line (the shift's route sketch): `inverseSurface` in light,
 *   `surfaceContainerLowest` in dark, so it is dark in both and the Lane yellow line reads on it.
 */
@Immutable
data class Surfaces(val page: Color, val card: Color, val fill: Color, val popover: Color, val road: Color) {
    companion object {
        fun of(scheme: ColorScheme, isDark: Boolean): Surfaces = Surfaces(
            page = scheme.background,
            card = if (isDark) scheme.surfaceContainer else scheme.surfaceContainerLowest,
            fill = if (isDark) scheme.surfaceContainerHighest else scheme.surfaceContainerHigh,
            popover = if (isDark) scheme.surfaceContainerHigh else scheme.surfaceContainerLowest,
            road = if (isDark) scheme.surfaceContainerLowest else scheme.inverseSurface,
        )
    }
}

val LocalSurfaces = staticCompositionLocalOf { Surfaces.of(BrandColors.Light, isDark = false) }

/**
 * MileWage's theme. Follows the phone's light or dark setting (or the Settings choice). Colours are
 * the brand scheme ([BrandColors], the web's m3-scheme.json) unless [wallpaperColours] is on and
 * the phone supports it; the earned and spent colours are then harmonised with the wallpaper's
 * primary colour, and the brand action takes the wallpaper's primary container instead of Lane yellow.
 */
@Composable
fun MileWageTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    wallpaperColours: Boolean = false,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val dynamic = wallpaperColours && wallpaperColoursAvailable
    val colorScheme: ColorScheme = when {
        dynamic && darkTheme -> dynamicDarkColorScheme(context)
        dynamic -> dynamicLightColorScheme(context)
        darkTheme -> BrandColors.Dark
        else -> BrandColors.Light
    }
    val extended = remember(colorScheme, darkTheme, dynamic) {
        when {
            dynamic -> extendedColors(darkTheme, harmonizeWith = colorScheme.primary.toArgb())
            darkTheme -> BrandColors.DarkExtended
            else -> BrandColors.LightExtended
        }
    }
    val surfaces = remember(colorScheme, darkTheme) { Surfaces.of(colorScheme, darkTheme) }
    CompositionLocalProvider(LocalExtendedColors provides extended, LocalSurfaces provides surfaces) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = MileWageTypography,
            shapes = MileWageShapes,
            content = content,
        )
    }
}

/** MileWage's colours beyond the Material roles: `MaterialTheme.extendedColors.earned`. */
val MaterialTheme.extendedColors: ExtendedColors
    @Composable @ReadOnlyComposable
    get() = LocalExtendedColors.current

/** The surface levels: `MaterialTheme.surfaces.card` for a card, `.page` for the screen. */
val MaterialTheme.surfaces: Surfaces
    @Composable @ReadOnlyComposable
    get() = LocalSurfaces.current
