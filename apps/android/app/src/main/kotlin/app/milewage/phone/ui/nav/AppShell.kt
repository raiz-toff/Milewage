package app.milewage.phone.ui.nav

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.navigation
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import app.milewage.phone.R
import app.milewage.phone.ui.components.LocalSnackbars
import app.milewage.phone.ui.components.MileWageSnackbarHost
import app.milewage.phone.ui.components.Snackbars
import app.milewage.phone.ui.screens.HomeScreen
import app.milewage.phone.ui.screens.SettingsScreen
import app.milewage.phone.ui.screens.ShiftDetailScreen
import app.milewage.phone.ui.screens.ShiftsScreen
import app.milewage.phone.ui.screens.WelcomeScreen
import kotlin.reflect.KClass

/** A destination in the bottom navigation bar. */
private enum class TopLevel(val route: Any, val routeClass: KClass<*>, @StringRes val label: Int, val icon: ImageVector) {
    HOME(HomeRoute, HomeRoute::class, R.string.nav_home, Icons.Filled.Home),
    SHIFTS(ShiftsRoute, ShiftsRoute::class, R.string.nav_shifts, Icons.AutoMirrored.Filled.List),
    SETTINGS(SettingsRoute, SettingsRoute::class, R.string.nav_settings, Icons.Filled.Settings),
}

/**
 * The navigation shell: first run until the phone is paired, then the app with a bottom bar of
 * Home, Shifts and Settings. One snackbar host for every screen ([LocalSnackbars]).
 *
 * `paired` is false until the pairing task gives the real state; "Get started" on Welcome goes on
 * to the app meanwhile.
 */
@Composable
fun AppShell(paired: Boolean = false) {
    val nav = rememberNavController()
    val snackbars = remember { Snackbars() }
    val entry by nav.currentBackStackEntryAsState()
    val destination = entry?.destination
    val showBar = TopLevel.entries.any { top -> destination?.hierarchy?.any { it.hasRoute(top.routeClass) } == true }

    CompositionLocalProvider(LocalSnackbars provides snackbars) {
        Scaffold(
            // Each screen's own Scaffold handles the status bar; this one only adds the bottom bar.
            contentWindowInsets = WindowInsets(0),
            snackbarHost = { MileWageSnackbarHost(snackbars) },
            bottomBar = {
                if (showBar) {
                    NavigationBar {
                        TopLevel.entries.forEach { top ->
                            val selected = destination?.hierarchy?.any { it.hasRoute(top.routeClass) } == true
                            NavigationBarItem(
                                selected = selected,
                                onClick = {
                                    nav.navigate(top.route) {
                                        // Home is the root of the app: tabs replace each other above it, each keeping its state.
                                        popUpTo<HomeRoute> { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                icon = { Icon(top.icon, contentDescription = null) },
                                label = { Text(stringResource(top.label)) },
                            )
                        }
                    }
                }
            },
        ) { padding ->
            NavHost(
                navController = nav,
                startDestination = if (paired) MainGraph else FirstRunGraph,
                modifier = Modifier.padding(padding).consumeWindowInsets(padding),
            ) {
                navigation<FirstRunGraph>(startDestination = WelcomeRoute) {
                    composable<WelcomeRoute> {
                        WelcomeScreen(
                            onGetStarted = {
                                nav.navigate(MainGraph) { popUpTo(FirstRunGraph) { inclusive = true } }
                            },
                        )
                    }
                }
                navigation<MainGraph>(startDestination = HomeRoute) {
                    composable<HomeRoute> { HomeScreen() }
                    composable<ShiftsRoute> {
                        ShiftsScreen(onOpenShift = { nav.navigate(ShiftDetailRoute(it)) })
                    }
                    composable<ShiftDetailRoute> { backStack ->
                        ShiftDetailScreen(
                            clientId = backStack.toRoute<ShiftDetailRoute>().clientId,
                            onBack = { nav.popBackStack() },
                        )
                    }
                    composable<SettingsRoute> { SettingsScreen() }
                }
            }
        }
    }
}
