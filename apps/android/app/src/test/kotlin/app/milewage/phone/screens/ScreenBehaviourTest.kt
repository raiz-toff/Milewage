package app.milewage.phone.screens

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.longClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.milewage.core.api.TripKind
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.TripRecord
import app.milewage.core.sync.ShiftMarker
import app.milewage.phone.logic.BannerKind
import app.milewage.phone.logic.EditOutcome
import app.milewage.core.connect.AddressProblem
import app.milewage.core.connect.ConnectFailure
import app.milewage.data.prefs.AppTheme
import app.milewage.phone.logic.ConnectError
import app.milewage.phone.logic.ConnectFix
import app.milewage.phone.logic.Fix
import app.milewage.phone.logic.FlagAdvice
import app.milewage.phone.logic.LinkFailure
import app.milewage.phone.logic.PermAction
import app.milewage.phone.logic.PermState
import app.milewage.phone.logic.PermStepId
import app.milewage.phone.logic.ReconReason
import app.milewage.phone.logic.SetupStep
import app.milewage.phone.logic.ShiftFlag
import app.milewage.phone.logic.ShiftFlags
import app.milewage.phone.logic.StartProblem
import app.milewage.phone.logic.TrackingLine
import app.milewage.phone.logic.TripChoice
import app.milewage.phone.ui.Texts
import app.milewage.phone.ui.components.rememberConfirmState
import app.milewage.phone.ui.components.ConfirmHost
import app.milewage.phone.ui.detail.DetailActions
import app.milewage.phone.ui.detail.DetailContent
import app.milewage.phone.ui.home.HomeContent
import app.milewage.phone.ui.shifts.ShiftsContent
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The screens' behaviour by role and name, on the JVM (Robolectric): what the Expo app's screen tests said. */
@RunWith(AndroidJUnit4::class)
// Tall, so every card of a screen is composed without scrolling.
@Config(sdk = [35], application = Application::class, qualifiers = "w360dp-h2400dp-xxhdpi")
class ScreenBehaviourTest {
    @get:Rule val compose = createComposeRule()

    private fun home(state: app.milewage.phone.ui.home.HomeState): RecordingHomeActions {
        val actions = RecordingHomeActions()
        compose.setContent {
            Framed {
                val confirm = rememberConfirmState()
                HomeContent(state, actions, confirm)
                ConfirmHost(confirm)
            }
        }
        return actions
    }

    @Test
    fun `Start shift is one button, the vehicles are a choice when there are several`() {
        val a = home(ScreenStates.homeIdle)
        compose.onNodeWithText("Start shift").assertIsDisplayed().performClick()
        assertEquals("start", a.calls.single())
        compose.onNodeWithText("Van").performClick()
        assertEquals("vehicle 4", a.calls.last())
    }

    @Test
    fun `another servers shifts say so in words, with connect first and delete second`() {
        val a = home(ScreenStates.homeOtherServer)
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Delete from this phone"))
        compose.onNodeWithText("2 shifts recorded for another server").assertIsDisplayed()
        compose.onNodeWithText(
            "They were never sent. They go only to old-box.tail9876.ts.net, the server they were recorded for. Connect this phone to that server again to send them.",
        ).assertIsDisplayed()
        compose.onNodeWithText("Connect to that server").performClick()
        compose.onNodeWithText("Delete from this phone").performClick()
        assertEquals(listOf("connectOther", "deleteOther"), a.calls)
    }

    @Test
    fun `End shift asks first, Keep recording leaves it running`() {
        val a = home(ScreenStates.running)
        compose.onNodeWithText("Shift running").assertIsDisplayed()
        compose.onNodeWithText("End shift").performClick()
        compose.onNodeWithText("End this shift?").assertIsDisplayed()
        compose.onNodeWithText("Recording stops at 23.4 km. You cannot restart this shift.").assertIsDisplayed()
        compose.onNodeWithText("Keep recording").performClick()
        assertTrue(a.calls.isEmpty())
        compose.onNodeWithText("End shift").performClick()
        compose.onAllNodesWithText("End shift")[1].performClick()
        assertEquals("end", a.calls.single())
    }

    @Test
    fun `a shift that is not recording offers to resume it or end it at its last point`() {
        val a = home(ScreenStates.runningLost)
        compose.onNodeWithText("This shift is not recording").assertIsDisplayed()
        compose.onNodeWithText("Resume recording").performClick()
        assertEquals("fix RESUME_RECORDING", a.calls.last())
        compose.onNodeWithText("End it at its last point").performClick()
        compose.onNodeWithText("End this shift at its last point?").assertIsDisplayed()
        compose.onAllNodesWithText("End shift").fetchSemanticsNodes().let { assertTrue(it.size >= 2) }
        compose.onAllNodesWithText("End shift")[1].performClick()
        assertEquals("close", a.calls.last())
        compose.onNodeWithContentDescription("Saved on your phone. It is sent when the server is reachable.").assertExists()
    }

    @Test
    fun `the running figures are read as one, with their notes`() {
        home(ScreenStates.running)
        compose.onNodeWithContentDescription("Distance, 23.4 km, Approximate. The server works out the final distance.").assertExists()
        compose.onNodeWithContentDescription("Deduction so far, $16.38, An estimate, at the rate on this phone.").assertExists()
    }

    @Test
    fun `the banner's one action, and the setup steps lead to their fix`() {
        val a = home(ScreenStates.homeIdle)
        compose.onNodeWithText("Send now").performClick()
        assertEquals("fix SEND_NOW", a.calls.last())
        compose.onNodeWithText("Allow notifications").performClick()
        assertEquals("fix NOTIFICATIONS", a.calls.last())
        // A step already done is not a button.
        compose.onNodeWithText("Allow location").performClick()
        assertEquals("fix NOTIFICATIONS", a.calls.last())
    }

    @Test
    fun `a long press on the title opens diagnostics`() {
        val a = home(ScreenStates.homeAllSent)
        compose.onNodeWithText("MileWage").performTouchInput { longClick() }
        assertEquals("diagnostics", a.calls.last())
    }

    @Test
    fun `no vehicles, says why, offers to try again`() {
        val a = home(ScreenStates.homeNoVehicles)
        compose.onNodeWithText("Your vehicles could not be loaded. Connect to the internet once so the phone can keep them.").assertIsDisplayed()
        compose.onNodeWithText("Try again").performClick()
        assertEquals("fix RETRY_VEHICLES", a.calls.last())
    }

    @Test
    fun `the shifts list opens a shift, empty says what to do`() {
        val opened = mutableListOf<String>()
        var home = 0
        compose.setContent { Framed { ShiftsContent(ScreenStates.shifts, { opened += it }, { home++ }, {}, {}) } }
        compose.onNodeWithText("This week").assertIsDisplayed()
        // Each row is read as one: day, times, distance, who calculated it, its send state, what to check.
        compose.onNodeWithContentDescription("Shift Mon, Nov 9, 11:00–15:30, 77.0 km, Confirmed by server · On server · Civic").performClick()
        assertEquals("a", opened.single())
        compose.onNodeWithContentDescription("Calculated on phone · On phone only · Civic", substring = true).assertExists()
        compose.onNodeWithContentDescription("114.0 km, Confirmed by server · On server · Civic, 1 thing to check", substring = true).assertExists()
    }

    @Test
    fun `an empty shifts list leads home`() {
        var home = 0
        compose.setContent { Framed { ShiftsContent(ScreenStates.shiftsEmpty, {}, { home++ }, {}, {}) } }
        compose.onNodeWithText("No shifts yet").assertIsDisplayed()
        compose.onNodeWithText("Go to Home").performClick()
        assertEquals(1, home)
    }

    @Test
    fun `each trip can be changed, and the server's change is explained and dismissed`() {
        val calls = mutableListOf<String>()
        val actions = object : DetailActions {
            override fun editTrip(trip: TripRecord, choice: TripChoice, purpose: String) {
                calls += "edit ${trip.tripKey} $choice $purpose"
            }

            override fun addTrip(distance: String, choice: TripChoice, purpose: String) {
                calls += "add $distance $choice"
            }

            override fun setOdometer(kind: OdometerKind, text: String) = Unit

            override fun setNotes(text: String) = Unit

            override fun dismissOverwrite(id: Long) {
                calls += "dismiss $id"
            }

            override fun sendNow() = Unit
        }
        compose.setContent { Framed { DetailContent(ScreenStates.detailFull, actions, {}) } }
        // The reasons in words, never a raw code.
        compose.onNodeWithText(
            "Server confirmed 12.3 km. Your phone showed 12.0 km (0.3 km difference). Points reached the server after the shift ended. The shift was changed on the web.",
        ).assertIsDisplayed()
        compose.onNodeWithText("Dismiss").performClick()
        assertEquals("dismiss 5", calls.last())
        compose.onNodeWithText("Active · Deliveries · estimated", substring = true).assertExists()
        // The trip dialog itself (a text field in a dialog window) never goes idle under Robolectric;
        // its choices and the edit are covered by TripChoiceTest and ShiftDetailViewModelTest.
        compose.onNodeWithContentDescription("Change trip at 11:00").assertExists()
        compose.onNodeWithText("Add a trip").assertExists()
    }

    @Test
    fun `every decision has its words`() {
        val res = ApplicationProvider.getApplicationContext<Application>().resources
        fun ok(id: Int) = assertTrue(res.getString(id).isNotBlank())
        Fix.entries.forEach { ok(Texts.fix(it)) }
        StartProblem.entries.forEach { ok(Texts.start(it)) }
        TrackingLine.entries.forEach { Texts.tracking(it).let { (a, b) -> ok(a); ok(b) } }
        BannerKind.entries.forEach { k -> Texts.banner(k)?.let(::ok) }
        SetupStep.entries.forEach { Texts.setup(it).let { (a, b) -> ok(a); ok(b) } }
        ShiftMarker.entries.forEach { ok(Texts.marker(it)) }
        ShiftFlag.entries.forEach { ok(Texts.flag(it)) }
        TripChoice.entries.forEach { ok(Texts.choice(it)) }
        EditOutcome.entries.forEach { o -> Texts.edit(o)?.let(::ok) }
        FlagAdvice.entries.forEach { ok(Texts.advice(it)) }
        ReconReason.entries.forEach { ok(Texts.reason(it)) }
        LinkFailure.entries.forEach { ok(Texts.linkFailure(it)) }
        ConnectFix.entries.forEach { ok(Texts.connectFix(it)) }
        AppTheme.entries.forEach { ok(Texts.theme(it)) }
        PermStepId.entries.forEach { id ->
            ok(Texts.permTitle(id))
            ok(Texts.permPurpose(id))
            PermState.entries.forEach { ok(Texts.permState(id, it)) }
            PermAction.entries.forEach { ok(Texts.permAction(id, it)) }
        }
        listOf(
            ConnectError.NotACode,
            ConnectError.AppTooOld,
            ConnectError.Address(AddressProblem.THIS_COMPUTER),
            ConnectError.Address(AddressProblem.INSECURE_OUTSIDE_HOME),
            ConnectError.Failed(ConnectFailure.HomeUnreachable("http://192.168.1.20")),
            ConnectError.Failed(ConnectFailure.TailscaleOff),
            ConnectError.Failed(ConnectFailure.TailnetNotAnswering),
            ConnectError.Failed(ConnectFailure.TailscaleUnknown),
            ConnectError.Failed(ConnectFailure.InvalidCode),
            ConnectError.Failed(ConnectFailure.RateLimited),
            ConnectError.Failed(ConnectFailure.NotMileWage),
            ConnectError.Failed(ConnectFailure.Unreachable),
            ConnectError.Failed(ConnectFailure.InsecureAddress),
            ConnectError.Failed(ConnectFailure.Other),
        ).forEach { ok(Texts.connectErrorRes(it)) }
        // The voice: no exclamation marks anywhere a driver reads.
        val strings = app.milewage.phone.R.string::class.java.fields.map { res.getString(it.getInt(null)) }
        strings.forEach { assertTrue('!' !in it, "\"$it\" has an exclamation mark") }
    }

    /**
     * Every code the server can send has the driver's words: the engine's flags (ShiftFlags.engineCodes,
     * kept in step by ShiftLogicTest) and the contract's reasons for a different total, read from
     * packages/shared/openapi/openapi.yaml so a new one fails here first.
     */
    @Test
    fun `every flag and reason code the server can send has words, never the raw code`() {
        val res = ApplicationProvider.getApplicationContext<Application>().resources
        val spec = generateSequence(java.io.File("").absoluteFile) { it.parentFile }
            .map { java.io.File(it, "packages/shared/openapi/openapi.yaml") }
            .first { it.exists() }
            .readText()
        val recon = Regex("""Recon:[\s\S]*?reasons: \{ type: array, items: \{ enum: \[([^\]]+)\]""").find(spec)!!.groupValues[1]
            .split(',').map { it.trim() }
        assertTrue(recon.size >= 6)
        recon.forEach { code ->
            val r = ReconReason.of(code)
            assertTrue(r != ReconReason.OTHER, "$code has no ReconReason")
            val words = res.getString(Texts.reason(r))
            assertTrue(code !in words && words.isNotBlank(), code)
        }
        ShiftFlags.engineCodes.forEach { code ->
            val f = ShiftFlag.of(code)
            assertTrue(f != ShiftFlag.OTHER, "$code has no ShiftFlag")
            assertTrue(code !in res.getString(Texts.flag(f)), code)
        }
    }
}
