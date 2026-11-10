package app.milewage.phone.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.milewage.core.format.DASH
import app.milewage.phone.BuildConfig
import app.milewage.phone.MileWageApp
import app.milewage.phone.R
import app.milewage.phone.ui.components.EmptyState
import app.milewage.phone.ui.components.ListRow
import app.milewage.phone.ui.components.Rows
import app.milewage.phone.ui.components.Screen
import app.milewage.phone.ui.components.StatTile
import app.milewage.phone.ui.components.StatTone
import app.milewage.phone.ui.theme.wallpaperColoursAvailable
import kotlinx.coroutines.launch

// Placeholder screens: each shows its name in a proper top app bar and uses the house components,
// so the theme can be checked on a phone. The screen tasks replace their bodies.

/** First run: what MileWage is, and the way in. Pairing replaces "Get started" with connecting. */
@Composable
fun WelcomeScreen(onGetStarted: () -> Unit) {
    Surface(Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Image(painterResource(R.drawable.ic_coin_road), contentDescription = null, modifier = Modifier.size(96.dp))
            Spacer(Modifier.height(24.dp))
            Text(stringResource(R.string.welcome_title), style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.welcome_body),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(32.dp))
            Button(onClick = onGetStarted, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.welcome_get_started)) }
        }
    }
}

@Composable
fun HomeScreen() {
    Screen(title = stringResource(R.string.nav_home)) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                StatTile(stringResource(R.string.home_week_distance), DASH, Modifier.weight(1f))
                StatTile(stringResource(R.string.home_week_earned), DASH, Modifier.weight(1f), tone = StatTone.EARNED)
            }
        }
        item {
            EmptyState(
                title = stringResource(R.string.home_no_shift_title),
                body = stringResource(R.string.home_no_shift_body),
            )
        }
    }
}

/** [onOpenShift]: the shifts list task opens ShiftDetail from a row with it. */
@Suppress("UNUSED_PARAMETER")
@Composable
fun ShiftsScreen(onOpenShift: (clientId: String) -> Unit) {
    Screen(title = stringResource(R.string.nav_shifts)) {
        item {
            EmptyState(
                icon = Icons.AutoMirrored.Filled.List,
                title = stringResource(R.string.shifts_empty_title),
                body = stringResource(R.string.shifts_empty_body),
            )
        }
    }
}

@Composable
fun ShiftDetailScreen(clientId: String, onBack: () -> Unit) {
    Screen(title = stringResource(R.string.shift_title), onBack = onBack) {
        item { Text(clientId, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
fun SettingsScreen() {
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
            }
        }
    }
}
