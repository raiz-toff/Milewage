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
import app.milewage.phone.ui.screens.WelcomeScreen
import app.milewage.phone.ui.shifts.ShiftsContent
import app.milewage.phone.ui.shifts.ShiftsState
import app.milewage.core.connect.Where
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

    @Test fun detailGone() = shot("detail-gone") { DetailContent(ScreenStates.detailGone, NoDetailActions, {}) }

    @Test fun diagnostics() = shot("diagnostics", tallDp = 1500) {
        DiagnosticsContent(DiagnosticsState(emptyList(), DIAG), {}, {})
    }

    @Test fun welcome() = shot("welcome-debug") { WelcomeScreen(linkAddress = null, onOpenUnpaired = {}) }

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
