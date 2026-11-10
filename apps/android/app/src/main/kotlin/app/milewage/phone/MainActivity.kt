package app.milewage.phone

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import app.milewage.phone.ui.ViewModels
import app.milewage.phone.ui.nav.AppShell
import app.milewage.phone.ui.nav.AppViewModel
import app.milewage.phone.ui.nav.Gate
import app.milewage.phone.ui.theme.MileWageTheme
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val app: MileWageApp get() = application as MileWageApp
    private val shell: AppViewModel by viewModels { ViewModels.app() }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val prefs = app.uiPreferences
        // The splash stays until the colour choice and the pairing state are read, so neither the
        // brand colours before the wallpaper colours nor the wrong first screen ever flash.
        var ready = false
        splash.setKeepOnScreenCondition { !ready }
        if (savedInstanceState == null) receive(intent)

        setContent {
            val wallpaper by remember { prefs.useWallpaperColours.map<Boolean, Boolean?> { it } }
                .collectAsStateWithLifecycle(initialValue = null)
            val gate by shell.gate.collectAsStateWithLifecycle()
            val link by shell.link.collectAsStateWithLifecycle()
            val choice = wallpaper
            if (choice != null && gate != Gate.LOADING) {
                SideEffect { ready = true }
                MileWageTheme(wallpaperColours = choice) {
                    AppShell(gate = gate, link = link, onLinkHandled = shell::consumeLink, onOpenUnpaired = app.graph::openUnpaired)
                }
            }
        }
    }

    // launchMode singleTask: a pairing link that arrives while the app runs comes here.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        receive(intent)
    }

    /** `milewage://pair?...` (and an https page link if one arrives) to the pairing layer's links. */
    private fun receive(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val url = intent.dataString ?: return
        lifecycleScope.launch { app.graph.links.receive(url) }
    }
}
