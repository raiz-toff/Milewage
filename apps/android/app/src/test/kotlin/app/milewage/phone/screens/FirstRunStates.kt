package app.milewage.phone.screens

import app.milewage.core.connect.ConnectFailure
import app.milewage.core.connect.FoundServer
import app.milewage.core.connect.Where
import app.milewage.data.prefs.AppTheme
import app.milewage.phone.logic.ConnectError
import app.milewage.phone.logic.ConnectionCheck
import app.milewage.phone.logic.DetectionOutcome
import app.milewage.phone.logic.LinkFailure
import app.milewage.phone.logic.Nearby
import app.milewage.phone.logic.PermissionFacts
import app.milewage.phone.logic.PermissionLadder
import app.milewage.phone.logic.Runtime
import app.milewage.phone.logic.ServerFacts
import app.milewage.phone.support.CIVIC
import app.milewage.phone.support.CREDENTIAL
import app.milewage.phone.support.PAIRED_STATE
import app.milewage.phone.support.VAN
import app.milewage.phone.ui.firstrun.ConnectState
import app.milewage.phone.ui.firstrun.LinkState
import app.milewage.phone.ui.firstrun.SetupState
import app.milewage.phone.ui.firstrun.TailscaleState
import app.milewage.phone.ui.permissions.PermissionsState
import app.milewage.phone.ui.settings.AppInfo
import app.milewage.phone.ui.settings.LibraryRow
import app.milewage.phone.ui.settings.SettingsState

/** The first-run, permissions and Settings states the tests and the screenshots draw. */
object FirstRunStates {
    val box = FoundServer("MileWage (box)", "http://192.168.1.20:8080", "inst-1")

    val connectLooking = ConnectState(nearby = Nearby.Looking)
    val connectFound = ConnectState(nearby = Nearby.Found(listOf(box)))
    val connectNone = ConnectState(nearby = Nearby.Found(emptyList()))
    val connectOffWifi = ConnectState(nearby = Nearby.OffWifi(tailscaleOff = true))
    val connectTailscaleOff = connectOffWifi.copy(error = ConnectError.Failed(ConnectFailure.TailscaleOff))
    val connectHomeUnreachable = connectFound.copy(error = ConnectError.Failed(ConnectFailure.HomeUnreachable("http://192.168.1.20:8080")))
    val connectBusy = connectFound.copy(busy = true)
    val connectPermission = ConnectState(nearby = Nearby.NeedsPermission)

    val linkAsking = LinkState.Asking
    val linkWaiting = LinkState.Waiting("482913")
    val linkExpired = LinkState.Failed(LinkFailure.EXPIRED)

    val tailscaleMissing = TailscaleState(installed = false, on = null)
    val tailscaleOff = TailscaleState(installed = true, on = false)
    val tailscaleReady = TailscaleState(installed = true, on = true)

    val facts = ServerFacts.of(PAIRED_STATE)
    val connected = SetupState(facts, listOf(CIVIC, VAN), checking = false)
    val connectedNoVehicle = SetupState(facts, emptyList(), checking = false)
    val connectedHomeOnly = SetupState(
        ServerFacts.of(PAIRED_STATE.copy(credential = CREDENTIAL.copy(baseUrl = "http://192.168.1.20:8080", awayUrl = null))),
        null,
        checking = false,
    )

    private val nothing = PermissionFacts(
        sdk = 35,
        locationSwitch = true,
        precise = Runtime(false),
        approximateOnly = false,
        background = Runtime(false),
        notificationsPermission = Runtime(false),
        notificationsOn = false,
        batteryExempt = false,
        maker = "Google",
    )

    private fun perms(f: PermissionFacts) = PermissionsState(
        PermissionLadder.steps(f),
        PermissionLadder.mode(f),
        PermissionLadder.battery(f.maker),
        "Allow all the time",
    )

    val permsNothing = perms(nothing)
    val permsWhileInUse = perms(nothing.copy(precise = Runtime(true), notificationsPermission = Runtime(true), notificationsOn = true, maker = "samsung"))
    val permsBlocked = perms(
        nothing.copy(
            locationSwitch = false,
            precise = Runtime(false, asked = true, rationale = false),
            notificationsPermission = Runtime(false, asked = true, rationale = false),
        ),
    )
    val permsApproximate = perms(nothing.copy(approximateOnly = true))
    val permsAll = perms(
        nothing.copy(precise = Runtime(true), background = Runtime(true), notificationsPermission = Runtime(true), notificationsOn = true, batteryExempt = true),
    )

    val info = AppInfo("0.3.0", 3, 4)

    val settings = SettingsState(
        facts = facts,
        where = Where.HOME,
        check = ConnectionCheck.Ok(Where.HOME),
        display = ScreenStates.settings,
        detection = true,
        theme = AppTheme.SYSTEM,
        helpBase = "http://192.168.1.20:8080",
    )
    val settingsTrouble = settings.copy(
        where = Where.AWAY,
        check = ConnectionCheck.Failed(ConnectError.Failed(ConnectFailure.TailscaleOff)),
        unsentShifts = 2,
        unsentFixes = 340,
        detection = false,
        detectionProblem = DetectionOutcome.NEEDS_ALL_THE_TIME,
        nudgeMs = 0,
        theme = AppTheme.DARK,
        helpBase = null,
    )

    val libraries = listOf(
        LibraryRow("AndroidX Camera Core", "1.6.2", listOf("Apache-2.0"), "https://developer.android.com/jetpack/androidx/releases/camera"),
        LibraryRow("OkHttp", "5.5.1", listOf("Apache-2.0"), "https://square.github.io/okhttp/"),
        LibraryRow("ZXing Core", "3.5.4", listOf("Apache-2.0"), null),
    )
}
