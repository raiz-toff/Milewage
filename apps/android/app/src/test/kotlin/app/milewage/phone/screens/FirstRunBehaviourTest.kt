package app.milewage.phone.screens

import android.app.Application
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.isNotEnabled
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.milewage.phone.logic.ConnectFix
import app.milewage.phone.logic.HelpLinks
import app.milewage.phone.logic.PermStep
import app.milewage.phone.logic.PermStepId
import app.milewage.phone.model.Countries
import app.milewage.phone.ui.firstrun.CameraAccess
import app.milewage.phone.ui.firstrun.CameraStandIn
import app.milewage.phone.ui.firstrun.ConnectActions
import app.milewage.phone.ui.firstrun.ConnectContent
import app.milewage.phone.ui.firstrun.ConnectState
import app.milewage.phone.ui.firstrun.ConnectedContent
import app.milewage.phone.ui.firstrun.ScanContent
import app.milewage.phone.ui.firstrun.TailscaleContent
import app.milewage.phone.ui.firstrun.WelcomeScreen
import app.milewage.phone.ui.permissions.PermissionsContent
import app.milewage.phone.ui.settings.LicencesContent
import app.milewage.phone.ui.settings.SettingsContent
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

/** First run, the permissions ladder and Settings by role and name, on the JVM (Robolectric). */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w360dp-h3000dp-xxhdpi")
class FirstRunBehaviourTest {
    @get:Rule val compose = createComposeRule()

    private class Recorder : ConnectActions {
        val calls = mutableListOf<String>()

        override fun back() {
            calls += "back"
        }

        override fun scan() {
            calls += "scan"
        }

        override fun submit(text: String) {
            calls += "submit $text"
        }

        override fun tailscale() {
            calls += "tailscale"
        }

        override fun fix(fix: ConnectFix) {
            calls += "fix $fix"
        }

        override fun dismissError() {
            calls += "dismiss"
        }
    }

    private fun connect(state: ConnectState): Recorder {
        val r = Recorder()
        compose.setContent { Framed { ConnectContent(state, r) } }
        return r
    }

    @Test
    fun `Welcome - what MileWage is, where the data stays, and the two ways on`() {
        var have = 0
        var none = 0
        compose.setContent { Framed { WelcomeScreen(revoked = true, onHaveServer = { have++ }, onNoServer = { none++ }) } }
        compose.onNodeWithText("Your data stays on your server", substring = true).assertIsDisplayed()
        compose.onNodeWithText("This phone was disconnected from your server. Connect again.").assertIsDisplayed()
        compose.onNodeWithText("I have a server").performClick()
        compose.onNodeWithText("I don't have one yet").performClick()
        assertEquals(1, have)
        assertEquals(1, none)
    }

    @Test
    fun `Connect - the scanner, a pasted code, and Tailscale for away from home`() {
        val r = connect(FirstRunStates.connect)
        compose.onNodeWithText("On this Wi-Fi").assertDoesNotExist()
        compose.onNode(hasText("Scan the code") and hasClickAction()).performClick()
        compose.onNodeWithText("Pairing code").performTextInput("milewage://pair?v=1")
        compose.onNodeWithText("Connect").performClick()
        compose.onNodeWithText("Away from home? Set up Tailscale").performClick()
        assertEquals(listOf("scan", "submit milewage://pair?v=1", "tailscale"), r.calls)
    }

    @Test
    fun `Connect - Tailscale off says so and opens Tailscale`() {
        val r = connect(FirstRunStates.connectTailscaleOff)
        compose.onNodeWithText("Tailscale is off on this phone. Open Tailscale, connect, then try again.").assertIsDisplayed()
        compose.onNodeWithText("Open Tailscale").performClick()
        compose.onNodeWithText("Away from home? Set up Tailscale").performClick()
        assertEquals(listOf("fix OPEN_TAILSCALE", "tailscale"), r.calls)
    }

    @Test
    fun `Connect - the home address names the host and offers Try again`() {
        val r = connect(FirstRunStates.connectHomeUnreachable)
        compose.onNodeWithText("Can't reach your server at 192.168.1.20.", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Try again").performClick()
        assertEquals(listOf("fix TRY_AGAIN"), r.calls)
    }

    @Test
    fun `Connect - busy while connecting, the field's button waits`() {
        connect(FirstRunStates.connectBusy)
        // The scanner's button and the field's both say so, and neither can be pressed twice.
        compose.onAllNodesWithText("Connecting…").assertCountEquals(2)
        compose.onAllNodes(hasText("Connecting…") and isNotEnabled()).assertCountEquals(2)
    }

    @Test
    fun `Scanner - camera refused offers to ask again, refused for good the app's settings, and pasting`() {
        var asked = 0
        var settings = 0
        var paste = 0
        val access = androidx.compose.runtime.mutableStateOf(CameraAccess.DENIED)
        compose.setContent {
            Framed { ScanContent(access.value, false, false, {}, {}, { asked++ }, { settings++ }, { paste++ }) { CameraStandIn() } }
        }
        compose.onNodeWithText("Camera permission is needed to scan.").assertIsDisplayed()
        compose.onNodeWithText("Allow camera").performClick()
        access.value = CameraAccess.BLOCKED
        compose.onNodeWithText("Camera access is off for MileWage.").assertIsDisplayed()
        compose.onNodeWithText("Open app settings").performClick()
        compose.onNodeWithText("Paste the code instead").performClick()
        assertEquals(listOf(1, 1, 1), listOf(asked, settings, paste))
    }

    @Test
    fun `Scanner - a stray code says so - the torch and close are named`() {
        compose.setContent { Framed { ScanContent(CameraAccess.GRANTED, false, true, {}, {}, {}, {}, {}) { CameraStandIn() } } }
        compose.onNodeWithText("That is not a MileWage pairing code. Point at the code on Devices in your web app.").assertIsDisplayed()
        compose.onNodeWithContentDescription("Turn torch on").assertIsDisplayed()
        compose.onNodeWithContentDescription("Close scanner").assertIsDisplayed()
    }

    @Test
    fun `Tailscale - installs or opens it, and can be skipped`() {
        var opened = 0
        var next = 0
        compose.setContent { Framed { TailscaleContent(FirstRunStates.tailscaleMissing, { opened++ }, { next++ }, {}) } }
        compose.onNode(hasText("Install Tailscale") and hasClickAction()).performClick()
        compose.onNodeWithText("Continue without Tailscale").performClick()
        assertEquals(1, opened)
        assertEquals(1, next)
    }

    @Test
    fun `Connected - which server, both addresses, and no vehicle sends the driver to the web with Check again`() {
        var checked = 0
        compose.setContent { Framed { ConnectedContent(FirstRunStates.connectedNoVehicle, Countries::name, { checked++ }, {}) } }
        compose.onNodeWithText("Connected to box.tail1234.ts.net as Sam.").assertIsDisplayed()
        compose.onNodeWithText("192.168.1.20").assertIsDisplayed()
        compose.onNodeWithText("Canada").assertIsDisplayed()
        compose.onNodeWithText("None yet").assertIsDisplayed()
        compose.onNodeWithText("Finish setup on the web: add your vehicle.").assertIsDisplayed()
        compose.onNodeWithText("Check again").performClick()
        assertEquals(1, checked)
    }

    @Test
    fun `Connected - only a home address says it works on the home Wi-Fi`() {
        compose.setContent { Framed { ConnectedContent(FirstRunStates.connectedHomeOnly, Countries::name, {}, {}) } }
        compose.onNodeWithText("Works on your home Wi-Fi.").assertIsDisplayed()
        compose.onNodeWithText("Not set up. Shifts are sent when the phone is on your home Wi-Fi.").assertIsDisplayed()
    }

    @Test
    fun `Permissions - each step for what it is, its state, and one button - Next in setup`() {
        val acted = mutableListOf<PermStepId>()
        var next = 0
        compose.setContent { Framed { PermissionsContent(FirstRunStates.permsNothing, true, { s: PermStep -> acted += s.id }, {}, {}, { next++ }) } }
        compose.onNodeWithText("MileWage cannot record miles yet.").assertIsDisplayed()
        compose.onNodeWithText("Precise location").assertIsDisplayed()
        compose.onNodeWithText("Allow location").performClick()
        compose.onNodeWithText("Allow precise location first").assertIsDisplayed()
        compose.onNodeWithText("Allow notifications").performClick()
        compose.onNodeWithText("Open battery settings").performClick()
        compose.onNodeWithText("Next").performClick()
        assertEquals(listOf(PermStepId.LOCATION, PermStepId.NOTIFICATIONS, PermStepId.BATTERY), acted)
        assertEquals(1, next)
    }

    @Test
    fun `Permissions - all the time with the system's own words, Samsung's battery advice`() {
        val acted = mutableListOf<PermStepId>()
        compose.setContent { Framed { PermissionsContent(FirstRunStates.permsWhileInUse, false, { s: PermStep -> acted += s.id }, {}, {}, {}) } }
        compose.onNodeWithText("You can record shifts.").assertIsDisplayed()
        compose.onNodeWithText("Location: Allow all the time").assertIsDisplayed()
        compose.onNodeWithText("Choose Allow all the time").performClick()
        compose.onNodeWithText("Never sleeping apps", substring = true).assertIsDisplayed()
        assertEquals(listOf(PermStepId.ALL_THE_TIME), acted)
    }

    @Test
    fun `Permissions - the switch off and refused for good lead to the settings pages`() {
        val acted = mutableListOf<PermStepId>()
        compose.setContent { Framed { PermissionsContent(FirstRunStates.permsBlocked, false, { s: PermStep -> acted += s.id }, {}, {}, {}) } }
        compose.onNodeWithText("Turn on location").performClick()
        compose.onNodeWithText("Open app settings").performClick()
        compose.onNodeWithText("Open notification settings").performClick()
        assertEquals(listOf(PermStepId.LOCATION_SWITCH, PermStepId.LOCATION, PermStepId.NOTIFICATIONS), acted)
    }

    @Test
    fun `Settings - the server, this phone, tracking, units from the server, help and about`() {
        val a = RecordingSettingsActions()
        compose.setContent { Framed { SettingsContent(FirstRunStates.settings, FirstRunStates.info, a) } }
        compose.onNodeWithText("192.168.1.20 (using now)").assertIsDisplayed()
        compose.onNodeWithText("Connected at home").assertIsDisplayed()
        compose.onNodeWithText("Check").performClick()
        compose.onNodeWithText("Connect to a different server").performClick()
        compose.onNodeWithText("Kilometres").assertIsDisplayed()
        compose.onNodeWithText("Set on the web, in Settings.", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Troubleshooting").performClick()
        compose.onNodeWithText("Open-source licences").performClick()
        compose.onNodeWithText("Version 4").assertIsDisplayed()
        compose.onNodeWithText("Diagnostics").performClick()
        assertEquals(
            listOf("check", "disconnect", "help ${HelpLinks.Page.TROUBLESHOOTING}", "licences", "diagnostics"),
            a.calls,
        )
    }

    @Test
    fun `Settings - a failed check has its way forward`() {
        val a = RecordingSettingsActions()
        compose.setContent { Framed { SettingsContent(FirstRunStates.settingsTrouble, FirstRunStates.info, a) } }
        compose.onNodeWithText("Tailscale is off on this phone. Open Tailscale, connect, then try again.").assertIsDisplayed()
        compose.onNodeWithText("Open Tailscale").performClick()
        compose.onNodeWithText("Send now").performClick()
        compose.onNodeWithText("2 shifts · 340 points").assertIsDisplayed()
        // Help is hidden when the server turned it off.
        compose.onNodeWithText("Troubleshooting").assertDoesNotExist()
        assertEquals(listOf("tailscale", "send"), a.calls)
    }

    @Test
    fun `Settings - the reminder dialog offers Off and minutes`() {
        val a = RecordingSettingsActions()
        compose.setContent { Framed { SettingsContent(FirstRunStates.settings, FirstRunStates.info, a) } }
        compose.onNodeWithText("After 30 minutes without moving").performClick()
        compose.onNodeWithText("Off").performClick()
        assertEquals(listOf("nudge 0"), a.calls)
    }

    @Test
    fun `Licences - this app's AGPL first, then each library and its licence`() {
        val opened = mutableListOf<String>()
        compose.setContent { Framed { LicencesContent(FirstRunStates.libraries, {}) { opened += it } } }
        compose.onNodeWithText("GNU Affero General Public License 3.0. Tap for the source.").performClick()
        compose.onNodeWithText("1.6.2 · Apache-2.0").assertIsDisplayed()
        compose.onNodeWithText("OkHttp").performClick()
        assertEquals(listOf("https://github.com/raiz-toff/Milewage", "https://square.github.io/okhttp/"), opened)
    }
}
