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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.navigation
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import app.milewage.core.pairing.LinkDecision
import app.milewage.phone.BuildConfig
import app.milewage.phone.R
import app.milewage.phone.ui.components.LocalSnackbars
import app.milewage.phone.ui.components.MileWageSnackbarHost
import app.milewage.phone.ui.components.Snackbars
import app.milewage.phone.ui.detail.ShiftDetailRoute as ShiftDetailScreenRoute
import app.milewage.phone.ui.diagnostics.DiagnosticsRoute as DiagnosticsScreenRoute
import app.milewage.phone.ui.home.HomeRoute as HomeScreenRoute
import app.milewage.phone.ui.screens.SettingsScreen
import app.milewage.phone.ui.screens.WelcomeScreen
import app.milewage.phone.ui.shifts.ShiftsRoute as ShiftsScreenRoute
import kotlin.reflect.KClass

/** A destination in the bottom navigation bar. */
private enum class TopLevel(val route: Any, val routeClass: KClass<*>, @StringRes val label: Int, val icon: ImageVector) {
    HOME(HomeRoute, HomeRoute::class, R.string.nav_home, Icons.Filled.Home),
    SHIFTS(ShiftsRoute, ShiftsRoute::class, R.string.nav_shifts, Icons.AutoMirrored.Filled.List),
    SETTINGS(SettingsRoute, SettingsRoute::class, R.string.nav_settings, Icons.Filled.Settings),
}

/**
 * The navigation shell: first run until the phone is paired ([Gate]), then the app with a bottom bar
 * of Home, Shifts and Settings. One snackbar host for every screen ([LocalSnackbars]).
 *
 * [gate] is never [Gate.LOADING] here (the splash stays until it is known). When it changes (paired,
 * unpaired, revoked with no shift running) the shell moves to the other graph. A pairing link that
 * opened the app goes to first run (the Connect screen, from the pairing task) or is a message.
 */
@Composable
fun AppShell(
    gate: Gate,
    link: LinkDecision?,
    onLinkHandled: () -> Unit,
    onOpenUnpaired: () -> Unit,
) {
    val nav = rememberNavController()
    val snackbars = remember { Snackbars() }
    val entry by nav.currentBackStackEntryAsState()
    val destination = entry?.destination
    val showBar = TopLevel.entries.any { top -> destination?.hierarchy?.any { it.hasRoute(top.routeClass) } == true }
    // The first graph is decided once; later changes navigate.
    val start = remember { if (gate == Gate.MAIN) MainGraph else FirstRunGraph }

    LaunchedEffect(gate) { moveTo(nav, gate) }

    val res = LocalResources.current
    LaunchedEffect(link) {
        when (link) {
            null -> Unit
            is LinkDecision.Ask -> {
                // Kept in the inbox: the pairing task's Connect screen consumes it.
                if (nav.currentDestination?.hierarchy?.any { it.hasRoute(FirstRunGraph::class) } != true) {
                    nav.navigate(FirstRunGraph) { launchSingleTop = true }
                }
            }
            LinkDecision.AlreadyConnected -> {
                onLinkHandled()
                snackbars.show(res.getString(R.string.link_already_connected))
            }
            LinkDecision.NotAPairingCode -> {
                onLinkHandled()
                snackbars.show(res.getString(R.string.link_not_a_code))
            }
        }
    }

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
                                onClick = { goTo(nav, top.route) },
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
                startDestination = start,
                modifier = Modifier.padding(padding).consumeWindowInsets(padding),
            ) {
                navigation<FirstRunGraph>(startDestination = WelcomeRoute) {
                    composable<WelcomeRoute> {
                        WelcomeScreen(
                            linkAddress = (link as? LinkDecision.Ask)?.link?.baseUrl,
                            onOpenUnpaired = if (BuildConfig.DEBUG) onOpenUnpaired else null,
                        )
                    }
                }
                navigation<MainGraph>(startDestination = HomeRoute) {
                    composable<HomeRoute> {
                        HomeScreenRoute(
                            onOpenShift = { nav.navigate(ShiftDetailRoute(it)) },
                            onOpenShifts = { goTo(nav, ShiftsRoute) },
                            onOpenDiagnostics = { nav.navigate(DiagnosticsRoute) },
                            onPair = { nav.navigate(FirstRunGraph) { launchSingleTop = true } },
                        )
                    }
                    composable<ShiftsRoute> {
                        ShiftsScreenRoute(onOpenShift = { nav.navigate(ShiftDetailRoute(it)) }, onGoHome = { goTo(nav, HomeRoute) })
                    }
                    composable<ShiftDetailRoute> { backStack ->
                        ShiftDetailScreenRoute(clientId = backStack.toRoute<ShiftDetailRoute>().clientId, onBack = { nav.popBackStack() })
                    }
                    composable<SettingsRoute> { SettingsScreen(onOpenDiagnostics = { nav.navigate(DiagnosticsRoute) }) }
                }
                composable<DiagnosticsRoute> { DiagnosticsScreenRoute(onBack = { nav.popBackStack() }) }
            }
        }
    }
}

/** A bottom-bar tab: tabs replace each other above Home, each keeping its state. */
private fun goTo(nav: NavHostController, route: Any) {
    nav.navigate(route) {
        popUpTo<HomeRoute> { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

/** Moves to the graph the gate names, dropping the other one from the back stack. */
private fun moveTo(nav: NavHostController, gate: Gate) {
    val inMain = nav.currentDestination?.hierarchy?.any { it.hasRoute(MainGraph::class) } == true
    val inFirstRun = nav.currentDestination?.hierarchy?.any { it.hasRoute(FirstRunGraph::class) } == true
    when {
        gate == Gate.MAIN && inFirstRun -> nav.navigate(MainGraph) { popUpTo(FirstRunGraph) { inclusive = true } }
        gate == Gate.FIRST_RUN && inMain -> nav.navigate(FirstRunGraph) { popUpTo(MainGraph) { inclusive = true } }
    }
}
