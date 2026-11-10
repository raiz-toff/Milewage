package app.milewage.phone.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.milewage.phone.BuildConfig
import app.milewage.phone.MileWageApp
import app.milewage.phone.R
import app.milewage.phone.ui.components.ListRow
import app.milewage.phone.ui.components.RowDivider
import app.milewage.phone.ui.components.Rows
import app.milewage.phone.ui.components.Screen
import app.milewage.phone.ui.theme.wallpaperColoursAvailable
import kotlinx.coroutines.launch

// Placeholder screens until the first-run and Settings task: Welcome (pairing comes next) and
// Settings (appearance, about, and the diagnostics entry).

/**
 * First run: what MileWage is. Pairing replaces this with connecting. [linkAddress]: a pairing link
 * opened the app (the Connect screen will take it). [onOpenUnpaired]: debug builds only, a way into
 * the app without pairing so the screens can be tried.
 */
@Composable
fun WelcomeScreen(linkAddress: String?, onOpenUnpaired: (() -> Unit)?) {
    Surface(Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Image(painterResource(R.drawable.ic_coin_road), contentDescription = null, modifier = Modifier.size(96.dp))
            Spacer(Modifier.height(24.dp))
            Text(
                stringResource(R.string.welcome_title),
                style = MaterialTheme.typography.headlineMedium,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.welcome_body),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(16.dp))
            Text(
                if (linkAddress != null) stringResource(R.string.welcome_link_arrived, linkAddress) else stringResource(R.string.welcome_next_build),
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
            if (onOpenUnpaired != null) {
                Spacer(Modifier.height(32.dp))
                OutlinedButton(onClick = onOpenUnpaired, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.welcome_debug_open))
                }
                Spacer(Modifier.height(8.dp))
                Text(
                    stringResource(R.string.welcome_debug_note),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

@Composable
fun SettingsScreen(onOpenDiagnostics: () -> Unit) {
    val app = LocalContext.current.applicationContext as MileWageApp
    val wallpaper by app.uiPreferences.useWallpaperColours.collectAsStateWithLifecycle(initialValue = false)
    val scope = rememberCoroutineScope()
    Screen(title = stringResource(R.string.nav_settings)) {
        item {
            Rows(label = stringResource(R.string.settings_appearance)) {
                ListRow(
                    headline = stringResource(R.string.settings_wallpaper_colours),
                    supporting = stringResource(
                        if (wallpaperColoursAvailable) R.string.settings_wallpaper_colours_body else R.string.settings_wallpaper_colours_unavailable,
                    ),
                    trailing = {
                        Switch(checked = wallpaper && wallpaperColoursAvailable, enabled = wallpaperColoursAvailable, onCheckedChange = null)
                    },
                    onClick = if (wallpaperColoursAvailable) {
                        { scope.launch { app.uiPreferences.setUseWallpaperColours(!wallpaper) } }
                    } else {
                        null
                    },
                )
            }
        }
        item {
            Rows(label = stringResource(R.string.settings_about)) {
                ListRow(
                    headline = stringResource(R.string.settings_version),
                    supporting = stringResource(R.string.settings_version_value, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
                )
                RowDivider()
                ListRow(
                    headline = stringResource(R.string.settings_diagnostics),
                    supporting = stringResource(R.string.settings_diagnostics_body),
                    onClick = onOpenDiagnostics,
                )
            }
        }
    }
}
