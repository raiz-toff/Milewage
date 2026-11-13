package app.milewage.phone.ui

import app.milewage.core.demo.Demo
import app.milewage.core.pairing.Credential
import app.milewage.core.pairing.LinkDecision
import app.milewage.core.pairing.PairedState
import app.milewage.core.pairing.PairingLink
import app.milewage.core.pairing.PairingLinks
import app.milewage.core.pairing.PairingStatus
import app.milewage.phone.logic.ServerFacts
import app.milewage.phone.support.FakeAppearance
import app.milewage.phone.support.FakeNet
import app.milewage.phone.support.FakePairing
import app.milewage.phone.support.FakeShiftData
import app.milewage.phone.support.FakeTracking
import app.milewage.phone.support.FakeTrackingSettings
import app.milewage.phone.support.FixedNow
import app.milewage.phone.support.SERVER_SETTINGS
import app.milewage.phone.support.runningView
import app.milewage.phone.ui.firstrun.ConnectViewModel
import app.milewage.phone.ui.home.HomeViewModel
import app.milewage.phone.ui.settings.SettingsEvent
import app.milewage.phone.ui.settings.SettingsViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** "Try it without a server": entering from first run, the mark on Home and Settings, and leaving. */
@OptIn(ExperimentalCoroutinesApi::class)
class DemoModeViewModelTest : VmTest() {
    private val pairing = FakePairing()
    private val data = FakeShiftData()
    private val links = MutableStateFlow<LinkDecision?>(null)

    private fun connect() = ConnectViewModel(pairing, FakeNet(), links, { links.value = null }, release = true)

    private fun settings() = SettingsViewModel(pairing, FakeNet(), data, FakeTrackingSettings(), FakeAppearance())

    @Test
    fun `Try it without a server enters the demo, and the setup steps follow as after any connection`() = runTest {
        val vm = connect()
        vm.tryDemo()
        assertEquals(listOf("enterDemo"), pairing.calls)
        assertEquals(PairingStatus.PAIRED, pairing.statusFlow.value)
        assertTrue(pairing.setup.value)
        assertTrue(pairing.demoFlow.value)
        assertFalse(vm.state.value.demoBusy)
        assertFalse(vm.state.value.demoFailed)
    }

    @Test
    fun `a demo that cannot be set up says so once and can be tried again`() = runTest {
        pairing.demoFailure = IllegalStateException("disk full")
        val vm = connect()
        vm.tryDemo()
        assertTrue(vm.state.value.demoFailed)
        assertEquals(PairingStatus.UNPAIRED, pairing.statusFlow.value)
        vm.demoFailureShown()
        assertFalse(vm.state.value.demoFailed)
        pairing.demoFailure = null
        vm.tryDemo()
        assertTrue(pairing.demoFlow.value)
    }

    @Test
    fun `connecting a real server from the demo leaves the demo first`() = runTest {
        pairing.enterDemo()
        pairing.calls.clear()
        val vm = connect()
        vm.submit(PairingLinks.links(PairingLink("https://box.tail1234.ts.net", "mwp_abcdefghijklmnop")).first)
        assertEquals(listOf("redeem https://box.tail1234.ts.net", "leaveDemo"), pairing.calls)
        assertFalse(pairing.demoFlow.value)
        assertEquals(PairingStatus.PAIRED, pairing.statusFlow.value)
    }

    @Test
    fun `Home shows the demo line only in the demo`() = runTest {
        val vm = HomeViewModel(data, FakeTracking(), FixedNow())
        collect(vm.state)
        assertFalse(vm.state.value.demo)
        data.demoFlow.value = true
        assertTrue(vm.state.value.demo)
        data.demoFlow.value = false
        assertFalse(vm.state.value.demo)
    }

    @Test
    fun `Settings in the demo - the mark, and Leave demo asks first, then leaves`() = runTest {
        pairing.enterDemo()
        pairing.calls.clear()
        val vm = settings()
        val events = collect(vm.events)
        assertTrue(vm.state.value.demo)

        vm.leaveDemo()
        assertEquals(SettingsEvent.AskLeaveDemo(running = false), events.last())
        assertTrue(pairing.calls.none { it == "leaveDemo" }, "nothing is deleted before the driver confirms")

        vm.confirmLeaveDemo()
        advanceUntilIdle()
        assertEquals(listOf("leaveDemo"), pairing.calls.filter { it == "leaveDemo" })
        assertEquals(PairingStatus.UNPAIRED, pairing.statusFlow.value)
        assertFalse(vm.state.value.demo)
    }

    @Test
    fun `Leave demo during a demo shift says the shift ends, and a failure offers Try again`() = runTest {
        pairing.enterDemo()
        data.running.value = runningView()
        val vm = settings()
        val events = collect(vm.events)
        vm.leaveDemo()
        assertEquals(SettingsEvent.AskLeaveDemo(running = true), events.last())
        pairing.demoFailure = IllegalStateException("disk")
        vm.confirmLeaveDemo()
        advanceUntilIdle()
        assertEquals(SettingsEvent.LeaveDemoFailed, events.last())
        assertTrue(pairing.demoFlow.value)
    }

    @Test
    fun `the demo server reads as the demo, never as a host name`() {
        val demo = PairedState(Credential(Demo.BASE_URL, awayUrl = Demo.BASE_URL, deviceId = 1, deviceToken = "mwd_demo", instanceId = Demo.INSTANCE), SERVER_SETTINGS)
        assertTrue(ServerFacts.of(demo).demo)
        val real = PairedState(Credential("https://box.tail1234.ts.net", deviceId = 1, deviceToken = "mwd_x"), SERVER_SETTINGS)
        assertFalse(ServerFacts.of(real).demo)
    }
}
