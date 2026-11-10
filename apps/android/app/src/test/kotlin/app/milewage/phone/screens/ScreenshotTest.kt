package app.milewage.phone.screens

import android.app.Application
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import app.milewage.phone.logic.DiagnosticsInfo
import app.milewage.phone.support.ALLOWED
import app.milewage.phone.ui.components.ConfirmHost
import app.milewage.phone.ui.components.ConfirmRequest
import app.milewage.phone.ui.components.rememberConfirmState
import app.milewage.phone.ui.detail.DetailActions
import app.milewage.phone.ui.detail.DetailContent
import app.milewage.phone.ui.diagnostics.DiagnosticsContent
import app.milewage.phone.ui.diagnostics.DiagnosticsState
import app.milewage.phone.ui.home.HomeContent
import app.milewage.phone.ui.home.HomeState
import app.milewage.phone.model.Countries
import app.milewage.phone.ui.firstrun.CameraAccess
import app.milewage.phone.ui.firstrun.CameraStandIn
import app.milewage.phone.ui.firstrun.ConnectContent
import app.milewage.phone.ui.firstrun.ConnectState
import app.milewage.phone.ui.firstrun.ConnectedContent
import app.milewage.phone.ui.firstrun.LinkContent
import app.milewage.phone.ui.firstrun.ReadyContent
import app.milewage.phone.ui.firstrun.ScanContent
import app.milewage.phone.ui.firstrun.ServerSetupScreen
import app.milewage.phone.ui.firstrun.TailscaleContent
import app.milewage.phone.ui.firstrun.WelcomeScreen
import app.milewage.phone.ui.permissions.PermissionsContent
import app.milewage.phone.ui.permissions.PermissionsState
import app.milewage.phone.ui.settings.LicencesContent
import app.milewage.phone.ui.settings.SettingsContent
import app.milewage.phone.ui.shifts.ShiftsContent
import app.milewage.phone.ui.shifts.ShiftsState
import app.milewage.core.connect.FoundServer
import app.milewage.core.connect.Where
import app.milewage.data.prefs.AppTheme
import app.milewage.phone.logic.ConnectFix
import app.milewage.phone.logic.Fix
import app.milewage.phone.logic.HelpLinks
import app.milewage.phone.ui.firstrun.ConnectActions
import app.milewage.phone.ui.settings.SettingsActions
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.TripRecord
import app.milewage.core.tracking.TrackingStatus
import app.milewage.phone.logic.TripChoice
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.captureScreenRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Every screen in each of its states, light and dark, drawn on the JVM (Robolectric's native
 * graphics). Running them checks that each state composes; `./gradlew :app:recordRoborazziDebug`
 * also writes the PNGs to `app/build/screens/` for the owner to look at.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "w360dp-h800dp-xxhdpi")
class ScreenshotTest(private val dark: Boolean) {
    @get:Rule val compose = createComposeRule()

    private val theme get() = if (dark) "dark" else "light"

    private fun shot(name: String, tallDp: Int? = null, fontScale: Float = 1f, windows: Boolean = false, content: @Composable () -> Unit) {
        if (tallDp != null) RuntimeEnvironment.setQualifiers("+h${tallDp}dp")
        compose.setContent { Framed(dark, fontScale) { content() } }
        compose.waitForIdle()
        val file = "build/screens/$name-$theme.png"
        if (windows) {
            @OptIn(ExperimentalRoborazziApi::class)
            captureScreenRoboImage(file)
        } else {
            compose.onRoot().captureRoboImage(file)
        }
    }

    private fun home(state: HomeState, name: String, tallDp: Int? = null, fontScale: Float = 1f) =
        shot(name, tallDp, fontScale) { HomeContent(state, RecordingHomeActions(), rememberConfirmState()) }

    @Test fun homeIdle() = home(ScreenStates.homeIdle, "home-idle", tallDp = 1500)

    @Test fun homeAllSent() = home(ScreenStates.homeAllSent, "home-all-sent", tallDp = 1000)

    @Test fun homeRevoked() = home(ScreenStates.homeRevoked, "home-revoked", tallDp = 1100)

    @Test fun homeOtherServer() = home(ScreenStates.homeOtherServer, "home-other-server", tallDp = 1300)

    @Test fun homeOtherServerDelete() = shot("home-other-server-delete-confirm", windows = true) {
        val confirm = rememberConfirmState()
        HomeContent(ScreenStates.homeOtherServer, RecordingHomeActions(), confirm)
        val res = androidx.compose.ui.platform.LocalResources.current
        confirm.ask(app.milewage.phone.ui.components.otherServerDeleteRequest(res, 2) {})
        ConfirmHost(confirm)
    }

    @Test fun homeNoVehicles() = home(ScreenStates.homeNoVehicles, "home-no-vehicles", tallDp = 1000)

    @Test fun homeSending() = home(ScreenStates.homeSending, "home-sending", tallDp = 1100)

    @Test fun homeLargeText() = home(ScreenStates.homeAllSent, "home-text-200", tallDp = 1800, fontScale = 2f)

    @Test fun running() = home(ScreenStates.running, "running-recording")

    @Test fun runningLow() = home(ScreenStates.runningLow, "running-saving-battery")

    @Test fun runningLost() = home(ScreenStates.runningLost, "running-not-recording", tallDp = 1300)

    @Test fun runningLocationOff() = home(ScreenStates.runningLocationOff, "running-location-off", tallDp = 1000)

    @Test fun runningLargeText() = home(ScreenStates.running, "running-text-200", tallDp = 1600, fontScale = 2f)

    @Test fun endConfirm() = shot("running-end-confirm", windows = true) {
        val confirm = rememberConfirmState()
        HomeContent(ScreenStates.running, RecordingHomeActions(), confirm)
        confirm.ask(ConfirmRequest("End this shift?", "Recording stops at 23.4 km. You cannot restart this shift.", "End shift", true, "Keep recording") {})
        ConfirmHost(confirm)
    }

    @Test fun shifts() = shot("shifts", tallDp = 1300) { ShiftsContent(ScreenStates.shifts, {}, {}, {}, {}) }

    @Test fun shiftsEmpty() = shot("shifts-empty") { ShiftsContent(ScreenStates.shiftsEmpty, {}, {}, {}, {}) }

    @Test fun detailFull() = shot("detail-stops", tallDp = 3200) { DetailContent(ScreenStates.detailFull, NoDetailActions, {}) }

    @Test fun detailSent() = shot("detail-sent-whole-shift", tallDp = 2400) { DetailContent(ScreenStates.detailSent, NoDetailActions, {}) }

    @Test fun detailOtherServer() = shot("detail-other-server", tallDp = 2600) { DetailContent(ScreenStates.detailOtherServer, NoDetailActions, {}) }

    @Test fun detailGone() = shot("detail-gone") { DetailContent(ScreenStates.detailGone, NoDetailActions, {}) }

    @Test fun diagnostics() = shot("diagnostics", tallDp = 1500) {
        DiagnosticsContent(DiagnosticsState(emptyList(), DIAG), {}, {})
    }

    @Test fun welcome() = shot("welcome") { WelcomeScreen(revoked = false, onHaveServer = {}, onNoServer = {}) }

    @Test fun welcomeRevoked() = shot("welcome-revoked") { WelcomeScreen(revoked = true, onHaveServer = {}, onNoServer = {}) }

    // First run (24 section 4.2, plan 28).
    @Test fun serverSetup() = shot("server-setup", tallDp = 1000) { ServerSetupScreen({}, {}, {}) }

    private fun connect(state: ConnectState, name: String, tallDp: Int? = 1300, fontScale: Float = 1f) =
        shot(name, tallDp, fontScale) { ConnectContent(state, NoConnectActions) }

    @Test fun connectLooking() = connect(FirstRunStates.connectLooking, "connect-looking")

    @Test fun connectFound() = connect(FirstRunStates.connectFound, "connect-found")

    @Test fun connectNone() = connect(FirstRunStates.connectNone, "connect-none-found")

    @Test fun connectOffWifi() = connect(FirstRunStates.connectTailscaleOff, "connect-off-wifi-tailscale-off", tallDp = 1500)

    @Test fun connectHomeUnreachable() = connect(FirstRunStates.connectHomeUnreachable, "connect-home-unreachable", tallDp = 1500)

    @Test fun connectBusy() = connect(FirstRunStates.connectBusy, "connect-busy")

    @Test fun connectPermission() = connect(FirstRunStates.connectPermission, "connect-local-network")

    @Test fun connectLargeText() = connect(FirstRunStates.connectFound, "connect-text-200", tallDp = 2600, fontScale = 2f)

    @Test fun connectConfirmLink() = shot("connect-confirm-link", windows = true) {
        ConnectContent(FirstRunStates.connectFound, NoConnectActions)
        val confirm = rememberConfirmState()
        confirm.ask(ConfirmRequest("Connect to this server?", "box.tail1234.ts.net\n\nShifts you record on this phone will be sent there. Only connect to your own MileWage server.", "Yes, connect") {})
        ConfirmHost(confirm)
    }

    private fun scan(access: CameraAccess, name: String, wrong: Boolean = false) =
        shot(name) { ScanContent(access, false, wrong, {}, {}, {}, {}, {}) { CameraStandIn() } }

    @Test fun scanCamera() = scan(CameraAccess.GRANTED, "scan-camera")

    @Test fun scanWrongCode() = scan(CameraAccess.GRANTED, "scan-wrong-code", wrong = true)

    @Test fun scanDenied() = scan(CameraAccess.DENIED, "scan-camera-denied")

    @Test fun scanBlocked() = scan(CameraAccess.BLOCKED, "scan-camera-blocked")

    @Test fun scanFailed() = scan(CameraAccess.FAILED, "scan-camera-failed")

    @Test fun linkAsking() = shot("link-asking") { LinkContent("MileWage (box)", "http://192.168.1.20:8080", FirstRunStates.linkAsking, {}, {}) }

    @Test fun linkWaiting() = shot("link-waiting") { LinkContent("MileWage (box)", "http://192.168.1.20:8080", FirstRunStates.linkWaiting, {}, {}) }

    @Test fun linkExpired() = shot("link-expired") { LinkContent("MileWage (box)", "http://192.168.1.20:8080", FirstRunStates.linkExpired, {}, {}) }

    @Test fun tailscaleMissing() = shot("tailscale-not-installed", tallDp = 1100) { TailscaleContent(FirstRunStates.tailscaleMissing, {}, {}, {}) }

    @Test fun tailscaleOff() = shot("tailscale-not-connected", tallDp = 1100) { TailscaleContent(FirstRunStates.tailscaleOff, {}, {}, {}) }

    @Test fun tailscaleReady() = shot("tailscale-ready", tallDp = 1100) { TailscaleContent(FirstRunStates.tailscaleReady, {}, {}, {}) }

    @Test fun connected() = shot("connected", tallDp = 1100) { ConnectedContent(FirstRunStates.connected, Countries::name, {}, {}) }

    @Test fun connectedNoVehicle() = shot("connected-no-vehicle", tallDp = 1200) { ConnectedContent(FirstRunStates.connectedNoVehicle, Countries::name, {}, {}) }

    @Test fun connectedHomeOnly() = shot("connected-home-only", tallDp = 1300) { ConnectedContent(FirstRunStates.connectedHomeOnly, Countries::name, {}, {}) }

    @Test fun ready() = shot("ready") { ReadyContent {} }

    // The permissions ladder.
    private fun perms(state: PermissionsState, name: String, setup: Boolean, tallDp: Int = 2200, fontScale: Float = 1f) =
        shot(name, tallDp, fontScale) { PermissionsContent(state, setup, {}, {}, {}, {}) }

    @Test fun permsNothing() = perms(FirstRunStates.permsNothing, "permissions-setup-nothing", setup = true, tallDp = 2400)

    @Test fun permsWhileInUse() = perms(FirstRunStates.permsWhileInUse, "permissions-while-in-use", setup = false)

    @Test fun permsBlocked() = perms(FirstRunStates.permsBlocked, "permissions-blocked-switch-off", setup = false, tallDp = 2400)

    @Test fun permsApproximate() = perms(FirstRunStates.permsApproximate, "permissions-approximate", setup = false, tallDp = 2400)

    @Test fun permsAll() = perms(FirstRunStates.permsAll, "permissions-all-allowed", setup = false, tallDp = 1300)

    @Test fun permsLargeText() = perms(FirstRunStates.permsWhileInUse, "permissions-text-200", setup = false, tallDp = 4200, fontScale = 2f)

    // Settings.
    @Test fun settings() = shot("settings", tallDp = 3600) { SettingsContent(FirstRunStates.settings, FirstRunStates.info, NoSettingsActions) }

    @Test fun settingsOtherServer() = shot("settings-other-server", tallDp = 3900) {
        SettingsContent(FirstRunStates.settingsOtherServer, FirstRunStates.info, NoSettingsActions)
    }

    @Test fun settingsTrouble() = shot("settings-check-failed-unsent", tallDp = 3600) {
        SettingsContent(FirstRunStates.settingsTrouble, FirstRunStates.info, NoSettingsActions)
    }

    @Test fun settingsLargeText() = shot("settings-text-200", tallDp = 7000, fontScale = 2f) {
        SettingsContent(FirstRunStates.settings, FirstRunStates.info, NoSettingsActions)
    }

    @Test fun settingsUnpair() = shot("settings-unpair-confirm", windows = true) {
        SettingsContent(FirstRunStates.settings, FirstRunStates.info, NoSettingsActions)
        val confirm = rememberConfirmState()
        confirm.ask(
            ConfirmRequest(
                "Connect to a different server?",
                "This phone stops sending shifts to box.tail1234.ts.net. Shifts not yet sent stay on this phone and are only ever sent to box.tail1234.ts.net. Then connect to the new server.",
                "Disconnect",
                destructive = true,
            ) {},
        )
        ConfirmHost(confirm)
    }

    @Test fun licences() = shot("licences") { LicencesContent(FirstRunStates.libraries, {}, {}) }

    @Test fun licencesFailed() = shot("licences-failed") { LicencesContent(null, {}, {}) }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "dark={0}")
        fun themes(): List<Array<Any>> = listOf(arrayOf(false), arrayOf(true))

        val DIAG = DiagnosticsInfo(
            "0.3.0", 3, "debug", 4, "16", 36, "Google Pixel 9", PairingStatus.PAIRED, Where.HOME, "192.168.1.20:3200", "box.tail1234.ts.net",
            TrackingStatus(), ALLOWED, 1, 342, null,
        )
    }
}

object NoDetailActions : DetailActions {
    override fun editTrip(trip: TripRecord, choice: TripChoice, purpose: String) = Unit

    override fun addTrip(distance: String, choice: TripChoice, purpose: String) = Unit

    override fun setOdometer(kind: OdometerKind, text: String) = Unit

    override fun setNotes(text: String) = Unit

    override fun dismissOverwrite(id: Long) = Unit

    override fun sendNow() = Unit
}

object NoConnectActions : ConnectActions {
    override fun back() = Unit

    override fun scan() = Unit

    override fun submit(text: String) = Unit

    override fun pick(server: FoundServer) = Unit

    override fun lookAgain() = Unit

    override fun tailscale() = Unit

    override fun allowLocalNetwork() = Unit

    override fun fix(fix: ConnectFix) = Unit

    override fun dismissError() = Unit
}

open class RecordingSettingsActions : SettingsActions {
    val calls = mutableListOf<String>()

    override fun check() {
        calls += "check"
    }

    override fun openTailscale() {
        calls += "tailscale"
    }

    override fun disconnect() {
        calls += "disconnect"
    }

    override fun setDetection(on: Boolean) {
        calls += "detection $on"
    }

    override fun fix(f: Fix) {
        calls += "fix $f"
    }

    override fun setNudge(minutes: Int) {
        calls += "nudge $minutes"
    }

    override fun setTheme(theme: AppTheme) {
        calls += "theme $theme"
    }

    override fun setWallpaper(on: Boolean) {
        calls += "wallpaper $on"
    }

    override fun sendNow() {
        calls += "send"
    }

    override fun openHelp(page: HelpLinks.Page) {
        calls += "help $page"
    }

    override fun openPermissions() {
        calls += "permissions"
    }

    override fun openLicences() {
        calls += "licences"
    }

    override fun openSource() {
        calls += "source"
    }

    override fun openDiagnostics() {
        calls += "diagnostics"
    }

    override fun deleteOtherServer() {
        calls += "deleteOther"
    }
}

object NoSettingsActions : RecordingSettingsActions()
