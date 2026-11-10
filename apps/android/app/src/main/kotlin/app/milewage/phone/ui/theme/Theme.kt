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
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext

/** Material 3's type scale on the system font (Roboto on most phones). No bundled font. */
val MileWageTypography = Typography()

/** Material 3's shape scale: extra small 4, small 8, medium 12, large 16, extra large 28 dp. */
val MileWageShapes = Shapes()

/** Whether the phone can give its wallpaper colours (Material You, Android 12 and later). */
val wallpaperColoursAvailable: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

/**
 * MileWage's theme. Follows the phone's light or dark setting. Colours are the brand scheme from
 * Lane yellow ([BrandColors]) unless [wallpaperColours] is on and the phone supports it; the earned
 * and spent colours are then harmonised with the wallpaper's primary colour.
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
            dynamic -> extendedColors(colorScheme.primary.toArgb(), darkTheme)
            darkTheme -> BrandColors.DarkExtended
            else -> BrandColors.LightExtended
        }
    }
    CompositionLocalProvider(LocalExtendedColors provides extended) {
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
