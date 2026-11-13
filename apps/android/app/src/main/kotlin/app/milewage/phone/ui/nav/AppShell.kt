package app.milewage.phone.ui.nav

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
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
import app.milewage.core.pairing.PairingStatus
import app.milewage.data.connect.AndroidNet
import app.milewage.phone.R
import app.milewage.phone.logic.ConnectFix
import app.milewage.phone.logic.Gate
import app.milewage.phone.model.Countries
import app.milewage.phone.ui.ViewModels
import app.milewage.phone.ui.components.LocalSnackbars
import app.milewage.phone.ui.components.MileWageSnackbarHost
import app.milewage.phone.ui.components.Snackbars
import app.milewage.phone.ui.firstrun.ConnectActions
import app.milewage.phone.ui.firstrun.ConnectContent
import app.milewage.phone.ui.firstrun.ConnectViewModel
import app.milewage.phone.ui.firstrun.ConnectedContent
import app.milewage.phone.ui.firstrun.ReadyContent
import app.milewage.phone.ui.firstrun.SERVER_STEPS
import app.milewage.phone.ui.firstrun.ScanRoute as ScanScreenRoute
import app.milewage.phone.ui.firstrun.ServerSetupScreen
import app.milewage.phone.ui.firstrun.SetupViewModel
import app.milewage.phone.ui.firstrun.TailscaleContent
import app.milewage.phone.ui.firstrun.TailscaleViewModel
import app.milewage.phone.ui.firstrun.WelcomeScreen
import app.milewage.phone.ui.permissions.PermissionsRoute as PermissionsScreenRoute
import app.milewage.phone.ui.settings.AppInfo
import app.milewage.phone.ui.settings.LicencesRoute as LicencesScreenRoute
import app.milewage.phone.ui.settings.SettingsRoute as SettingsScreenRoute
import app.milewage.phone.ui.detail.ShiftDetailRoute as ShiftDetailScreenRoute
import app.milewage.phone.ui.diagnostics.DiagnosticsRoute as DiagnosticsScreenRoute
import app.milewage.phone.ui.home.HomeRoute as HomeScreenRoute
import app.milewage.phone.ui.shifts.ShiftsRoute as ShiftsScreenRoute
import kotlinx.coroutines.launch
import kotlin.reflect.KClass
import app.milewage.phone.ui.theme.surfaces
import app.milewage.phone.ui.theme.fadeThroughIn
import app.milewage.phone.ui.theme.fadeThroughOut
import app.milewage.phone.ui.theme.sharedAxisXIn
import app.milewage.phone.ui.theme.sharedAxisXOut
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.material3.MaterialTheme

/**
 * The navigation shell: first run until the phone is paired, the setup steps after a first
 * connection, then the app with a bottom bar of Home, Shifts and Settings ([Gate]). One snackbar
 * host for every screen ([LocalSnackbars]).
 *
 * [shell] is never [Gate.LOADING] here (the splash stays until it is known). When the gate changes
 * (paired, setup finished, unpaired, revoked with no shift running) the shell moves to the other
 * graph by itself; no screen navigates there. A pairing link that opened the app goes to Connect
 * (which asks first) or is a message.
 */
@Composable
fun AppShell(
    shell: ShellState,
    link: LinkDecision?,
    onLinkHandled: () -> Unit,
    net: AndroidNet?,
    info: AppInfo,
) {
    val nav = rememberNavController()
    val snackbars = remember { Snackbars() }
    val entry by nav.currentBackStackEntryAsState()
    val destination = entry?.destination
    val showBar = TopLevel.entries.any { top -> destination?.hierarchy?.any { it.hasRoute(top.routeClass) } == true }
    // The first graph is decided once; later changes navigate.
    val start: Any = remember {
        when (shell.gate) {
            Gate.MAIN -> MainGraph
            Gate.SETUP -> SetupGraph
            else -> FirstRunGraph
        }
    }

    LaunchedEffect(shell) { moveTo(nav, shell) }

    val res = LocalResources.current
    LaunchedEffect(link) {
        when (link) {
            null -> Unit
            // Connect takes it from the inbox and asks "Connect to this server?" first.
            is LinkDecision.Ask -> if (nav.currentDestination?.hasRoute(ConnectRoute::class) != true) {
                if (graphOf(nav) == FirstRunGraph::class) {
                    nav.navigate(ConnectRoute) { launchSingleTop = true }
                } else {
                    nav.navigate(FirstRunGraph) { launchSingleTop = true }
                    nav.navigate(ConnectRoute) { launchSingleTop = true }
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
                    val selected = TopLevel.entries.firstOrNull { top -> destination?.hierarchy?.any { it.hasRoute(top.routeClass) } == true }
                    MainNavigationBar(selected) { goTo(nav, it.route) }
                }
            },
        ) { padding ->
            NavHost(
                navController = nav,
                startDestination = start,
                modifier = Modifier.padding(padding).consumeWindowInsets(padding),
                // Material motion: deeper and back slide on the X axis (the back gesture scrubs it);
                // peers (the tabs, first run and the app) fade through.
                enterTransition = { if (peers()) fadeThroughIn() else sharedAxisXIn(forward = true) },
                exitTransition = { if (peers()) fadeThroughOut() else sharedAxisXOut(forward = true) },
                popEnterTransition = { if (peers()) fadeThroughIn() else sharedAxisXIn(forward = false) },
                popExitTransition = { if (peers()) fadeThroughOut() else sharedAxisXOut(forward = false) },
            ) {
                firstRun(nav, shell)
                setup(nav, net)
                navigation<MainGraph>(startDestination = HomeRoute) {
                    composable<HomeRoute> {
                        HomeScreenRoute(
                            onOpenShift = { nav.navigate(ShiftDetailRoute(it)) },
                            onOpenShifts = { goTo(nav, ShiftsRoute) },
                            onOpenDiagnostics = { nav.navigate(DiagnosticsRoute) },
                            onOpenPermissions = { nav.navigate(PermissionsRoute) { launchSingleTop = true } },
                            onPair = { nav.navigate(FirstRunGraph) { launchSingleTop = true } },
                            onOpenSettings = { goTo(nav, SettingsRoute) },
                        )
                    }
                    composable<ShiftsRoute> {
                        ShiftsScreenRoute(onOpenShift = { nav.navigate(ShiftDetailRoute(it)) }, onGoHome = { goTo(nav, HomeRoute) })
                    }
                    composable<ShiftDetailRoute> { backStack ->
                        ShiftDetailScreenRoute(
                            clientId = backStack.toRoute<ShiftDetailRoute>().clientId,
                            onBack = { nav.popBackStack() },
                            onOpenPermissions = { nav.navigate(PermissionsRoute) { launchSingleTop = true } },
                        )
                    }
                    composable<SettingsRoute> {
                        SettingsScreenRoute(
                            onOpenPermissions = { nav.navigate(PermissionsRoute) { launchSingleTop = true } },
                            onOpenLicences = { nav.navigate(LicencesRoute) },
                            onOpenDiagnostics = { nav.navigate(DiagnosticsRoute) },
                            info = info,
                        )
                    }
                    composable<PermissionsRoute> {
                        PermissionsScreenRoute(setup = false, net = net, onBack = { nav.popBackStack() }, onNext = { nav.popBackStack() })
                    }
                    composable<LicencesRoute> { LicencesScreenRoute(onBack = { nav.popBackStack() }) }
                    composable<DiagnosticsRoute> { DiagnosticsScreenRoute(onBack = { nav.popBackStack() }) }
                }
            }
        }
    }
}

/** The graph a destination belongs to (first run, setup or the app). */
private fun graphClass(entry: NavBackStackEntry): KClass<*>? = listOf(FirstRunGraph::class, SetupGraph::class, MainGraph::class)
    .firstOrNull { g -> entry.destination.hierarchy.any { it.hasRoute(g) } }

private fun isTopLevel(entry: NavBackStackEntry): Boolean =
    TopLevel.entries.any { top -> entry.destination.hierarchy.any { it.hasRoute(top.routeClass) } }

/** Peers fade through: two bottom tabs, or a move between graphs (paired, unpaired, setup done). */
private fun AnimatedContentTransitionScope<NavBackStackEntry>.peers(): Boolean =
    (isTopLevel(initialState) && isTopLevel(targetState)) || graphClass(initialState) != graphClass(targetState)

/** First run's screens; Connect's view model is shared with the scanner (scoped to this graph). */
private fun androidx.navigation.NavGraphBuilder.firstRun(nav: NavHostController, shell: ShellState) {
    navigation<FirstRunGraph>(startDestination = WelcomeRoute) {
        composable<WelcomeRoute> { backStack ->
            val vm = connectViewModel(nav, backStack)
            val state by vm.state.collectAsStateWithLifecycle()
            val res = LocalResources.current
            val snackbars = LocalSnackbars.current
            LaunchedEffect(state.demoFailed) {
                if (state.demoFailed) {
                    vm.demoFailureShown()
                    snackbars.show(res.getString(R.string.demo_failed), res.getString(R.string.try_again)) { vm.tryDemo() }
                }
            }
            WelcomeScreen(
                revoked = shell.status == PairingStatus.REVOKED,
                onHaveServer = { nav.navigate(ConnectRoute) },
                onNoServer = { nav.navigate(ServerSetupRoute) },
                onTryDemo = vm::tryDemo,
                demoBusy = state.demoBusy,
            )
        }
        composable<ServerSetupRoute> {
            val context = LocalContext.current
            val res = LocalResources.current
            val snackbars = LocalSnackbars.current
            val scope = androidx.compose.runtime.rememberCoroutineScope()
            ServerSetupScreen(
                onBack = { nav.popBackStack() },
                onShare = {
                    val text = buildString {
                        appendLine(res.getString(R.string.server_setup_share_intro))
                        SERVER_STEPS.forEachIndexed { i, (t, d) -> appendLine("${i + 1}. ${res.getString(t)}. ${res.getString(d)}") }
                    }.trim()
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain")
                        .putExtra(Intent.EXTRA_SUBJECT, res.getString(R.string.server_setup_share_title))
                        .putExtra(Intent.EXTRA_TEXT, text)
                    try {
                        context.startActivity(Intent.createChooser(send, res.getString(R.string.server_setup_share)))
                    } catch (_: ActivityNotFoundException) {
                        scope.launch { snackbars.show(res.getString(R.string.share_failed)) }
                    }
                },
                onReady = { nav.navigate(ConnectRoute) },
            )
        }
        composable<ConnectRoute> { backStack ->
            val vm = connectViewModel(nav, backStack)
            val state by vm.state.collectAsStateWithLifecycle()
            val actions = remember(vm) {
                object : ConnectActions {
                    override fun back() {
                        nav.popBackStack()
                    }

                    override fun scan() = nav.navigate(ScanRoute)

                    override fun submit(text: String) = vm.submit(text)

                    override fun tailscale() = nav.navigate(TailscaleRoute)

                    override fun fix(fix: ConnectFix) = when (fix) {
                        ConnectFix.TRY_AGAIN -> vm.retry()
                        ConnectFix.OPEN_TAILSCALE -> vm.openTailscale()
                        ConnectFix.SCAN -> {
                            vm.dismissError()
                            nav.navigate(ScanRoute)
                        }
                    }

                    override fun dismissError() = vm.dismissError()
                }
            }
            ConnectContent(state, actions)
            state.confirm?.let { link ->
                ConfirmLinkDialog(link.baseUrl, onYes = vm::confirmLink, onNo = vm::cancelLink)
            }
        }
        composable<ScanRoute> { backStack ->
            val vm = connectViewModel(nav, backStack)
            ScanScreenRoute(
                onCode = { text ->
                    nav.popBackStack()
                    vm.submit(text)
                },
                onClose = { nav.popBackStack() },
                onPasteInstead = { nav.popBackStack() },
            )
        }
        composable<TailscaleRoute> {
            val vm: TailscaleViewModel = viewModel(factory = ViewModels.tailscale())
            val state by vm.state.collectAsStateWithLifecycle()
            // Back from Tailscale or the app store: check again.
            LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.refresh() }
            TailscaleContent(state, onOpen = vm::open, onContinue = { nav.popBackStack() }, onBack = { nav.popBackStack() })
        }
    }
}

/** The setup steps after a first connection; Ready finishes them and the gate shows Home. */
private fun androidx.navigation.NavGraphBuilder.setup(nav: NavHostController, net: AndroidNet?) {
    navigation<SetupGraph>(startDestination = ConnectedRoute) {
        composable<ConnectedRoute> { backStack ->
            val vm = setupViewModel(nav, backStack)
            val state by vm.state.collectAsStateWithLifecycle()
            ConnectedContent(state, countryName = Countries::name, onCheck = vm::load, onNext = { nav.navigate(SetupPermissionsRoute) })
        }
        composable<SetupPermissionsRoute> {
            PermissionsScreenRoute(setup = true, net = net, onBack = { nav.popBackStack() }, onNext = { nav.navigate(ReadyRoute) })
        }
        composable<ReadyRoute> { backStack ->
            val vm = setupViewModel(nav, backStack)
            ReadyContent(onGo = vm::finish)
        }
    }
}

@Composable
private fun connectViewModel(nav: NavHostController, entry: NavBackStackEntry): ConnectViewModel {
    val parent = remember(entry) { nav.getBackStackEntry(FirstRunGraph) }
    return viewModel(parent, factory = ViewModels.connect())
}

@Composable
private fun setupViewModel(nav: NavHostController, entry: NavBackStackEntry): SetupViewModel {
    val parent = remember(entry) { nav.getBackStackEntry(SetupGraph) }
    return viewModel(parent, factory = ViewModels.setup())
}

/** "Connect to this server?" before a link that opened the app is used (anyone can make one). */
@Composable
private fun ConfirmLinkDialog(baseUrl: String, onYes: () -> Unit, onNo: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onNo,
        containerColor = MaterialTheme.surfaces.popover,
        title = { Text(stringResource(R.string.link_confirm_title)) },
        text = { Text(stringResource(R.string.link_confirm_text, app.milewage.phone.logic.Hosts.of(baseUrl) ?: baseUrl)) },
        confirmButton = { androidx.compose.material3.TextButton(onClick = onYes) { Text(stringResource(R.string.link_confirm_yes)) } },
        dismissButton = { androidx.compose.material3.TextButton(onClick = onNo) { Text(stringResource(R.string.cancel)) } },
    )
}

/** A bottom-bar tab: tabs replace each other above Home, each keeping its state. */
private fun goTo(nav: NavHostController, route: Any) {
    nav.navigate(route) {
        popUpTo<HomeRoute> { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

/** Which of the three graphs the current screen is in. */
private fun graphOf(nav: NavHostController): KClass<*>? {
    val h = nav.currentDestination?.hierarchy ?: return null
    return listOf(FirstRunGraph::class, SetupGraph::class, MainGraph::class).firstOrNull { g -> h.any { it.hasRoute(g) } }
}

/**
 * Moves to the graph the gate names, dropping the rest of the back stack. A driver who opened first
 * run from Home to pair again mid-shift (gate MAIN, not paired yet) stays there until paired.
 */
private fun moveTo(nav: NavHostController, shell: ShellState) {
    val here = graphOf(nav) ?: return
    val target: Any = when (shell.gate) {
        Gate.LOADING -> return
        Gate.FIRST_RUN -> FirstRunGraph
        Gate.SETUP -> SetupGraph
        Gate.MAIN -> MainGraph
    }
    if (here == target::class) return
    if (target == MainGraph && here == FirstRunGraph::class && shell.status != PairingStatus.PAIRED) return
    nav.navigate(target) { popUpTo(nav.graph.id) { inclusive = true } }
}
