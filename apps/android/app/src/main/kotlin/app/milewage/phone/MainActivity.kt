package app.milewage.phone

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.milewage.phone.ui.nav.AppShell
import app.milewage.phone.ui.theme.MileWageTheme
import kotlinx.coroutines.flow.map

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val prefs = (application as MileWageApp).uiPreferences
        // The splash stays until the colour choice is read, so the brand colours never flash
        // before the wallpaper colours.
        var ready = false
        splash.setKeepOnScreenCondition { !ready }

        setContent {
            val wallpaper by remember { prefs.useWallpaperColours.map<Boolean, Boolean?> { it } }
                .collectAsStateWithLifecycle(initialValue = null)
            wallpaper?.let { choice ->
                SideEffect { ready = true }
                MileWageTheme(wallpaperColours = choice) {
                    AppShell()
                }
            }
        }
    }
}
