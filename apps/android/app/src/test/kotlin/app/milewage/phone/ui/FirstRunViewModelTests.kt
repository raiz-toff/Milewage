package app.milewage.phone.ui

import app.milewage.core.api.ApiCodes
import app.milewage.core.api.ApiException
import app.milewage.core.connect.AddressProblem
import app.milewage.core.connect.ConnectFailure
import app.milewage.core.connect.FoundServer
import app.milewage.core.connect.Where
import app.milewage.core.pairing.LinkDecision
import app.milewage.core.pairing.PairingLink
import app.milewage.core.pairing.PairingLinks
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.sync.OtherServerShifts
import app.milewage.data.prefs.AppTheme
import app.milewage.phone.logic.ConnectError
import app.milewage.phone.logic.ConnectionCheck
import app.milewage.phone.logic.DetectionOutcome
import app.milewage.phone.logic.LinkFailure
import app.milewage.phone.logic.Nearby
import app.milewage.phone.support.ALLOWED
import app.milewage.phone.support.CIVIC
import app.milewage.phone.support.FakeAppearance
import app.milewage.phone.support.FakeNet
import app.milewage.phone.support.FakePairing
import app.milewage.phone.support.FakeShiftData
import app.milewage.phone.support.FakeTrackingSettings
import app.milewage.phone.support.runningView
import app.milewage.phone.support.sendStatus
import app.milewage.phone.ui.firstrun.ConnectEvent
import app.milewage.phone.ui.firstrun.ConnectViewModel
import app.milewage.phone.ui.firstrun.LinkState
import app.milewage.phone.ui.firstrun.LinkViewModel
import app.milewage.phone.ui.firstrun.SetupViewModel
import app.milewage.phone.ui.firstrun.TailscaleState
import app.milewage.phone.ui.firstrun.TailscaleViewModel
import app.milewage.phone.ui.settings.SettingsEvent
import app.milewage.phone.ui.settings.SettingsViewModel
import app.milewage.tracking.TrackingController.DetectionResult
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val TOKEN = "mwp_abcdefghijklmnop"
private val LINK = PairingLink("https://box.tail1234.ts.net", TOKEN, "http://192.168.1.20:8080")
private val CODE = PairingLinks.links(LINK).first

@OptIn(ExperimentalCoroutinesApi::class)
class ConnectViewModelTest : VmTest() {
    private val pairing = FakePairing()
    private val net = FakeNet()
    private val links = MutableStateFlow<LinkDecision?>(null)

    private fun vm(release: Boolean = true) = ConnectViewModel(pairing, net, links, { links.value = null }, release)

    @Test
    fun `on the Wi-Fi it finds the server - none found says so and looks again`() = runTest {
        val box = FoundServer("MileWage (box)", "http://192.168.1.20:8080", "inst-1")
        val vm = vm()
        assertEquals(Nearby.Found(emptyList()), vm.state.value.nearby)
        net.servers = listOf(box)
        vm.look()
        assertEquals(Nearby.Found(listOf(box)), vm.state.value.nearby)
        assertEquals(2, net.discovered)
    }

    @Test
    fun `off Wi-Fi it says so and offers Tailscale only when Tailscale is off or missing`() = runTest {
        net.local = false
        assertEquals(Nearby.OffWifi(tailscaleOff = true), vm().state.value.nearby)
        net.installed = true
        net.vpn = true
        assertEquals(Nearby.OffWifi(tailscaleOff = false), vm().state.value.nearby)
        assertEquals(0, net.discovered)
    }

    @Test
    fun `Android 17 asks for local network first`() = runTest {
        net.permissionNeeded = true
        assertEquals(Nearby.NeedsPermission, vm().state.value.nearby)
        assertEquals(0, net.discovered)
    }

    @Test
    fun `a pasted code connects, the pairing changes and nothing else is needed`() = runTest {
        val vm = vm()
        vm.submit(CODE)
        assertEquals(listOf("redeem https://box.tail1234.ts.net"), pairing.calls)
        assertEquals(PairingStatus.PAIRED, pairing.statusFlow.value)
        assertEquals(true, pairing.setup.value) // the setup steps follow (the gate shows them)
        assertNull(vm.state.value.error)
        assertEquals(false, vm.state.value.busy)
    }

    @Test
    fun `a bad or used code and a stray text say so clearly, nothing is sent for a stray one`() = runTest {
        val vm = vm()
        vm.submit("hello")
        assertEquals(ConnectError.NotACode, vm.state.value.error)
        pairing.redeemFailure = ApiException(401, ApiCodes.INVALID_PAIRING_TOKEN, false)
        vm.submit(CODE)
        assertEquals(ConnectError.Failed(ConnectFailure.InvalidCode), vm.state.value.error)
        assertEquals(1, pairing.calls.size)
    }

    @Test
    fun `a code from localhost is refused before anything is sent`() = runTest {
        val vm = vm()
        vm.submit(PairingLinks.links(PairingLink("http://localhost:3000", TOKEN)).first)
        assertEquals(ConnectError.Address(AddressProblem.THIS_COMPUTER), vm.state.value.error)
        assertTrue(pairing.calls.isEmpty())
    }

    @Test
    fun `Tailscale off - says so, opens Tailscale, and Try again redeems again`() = runTest {
        net.vpn = false
        pairing.redeemFailure = ApiException(0, ApiCodes.NETWORK, true)
        val vm = vm()
        vm.submit(CODE)
        assertEquals(ConnectError.Failed(ConnectFailure.TailscaleOff), vm.state.value.error)
        vm.openTailscale()
        assertEquals(1, net.opened)
        pairing.redeemFailure = null
        vm.retry()
        assertEquals(2, pairing.calls.size)
        assertEquals(PairingStatus.PAIRED, pairing.statusFlow.value)
    }

    @Test
    fun `a typed server address opens linking with a code there`() = runTest {
        val vm = vm()
        val events = collect(vm.events)
        vm.submit("192.168.1.20:8080")
        assertEquals(listOf<ConnectEvent>(ConnectEvent.OpenLink("http://192.168.1.20:8080", "192.168.1.20")), events)
        assertTrue(pairing.calls.isEmpty())
    }

    @Test
    fun `a link that opened the app asks which server first - Cancel sends nothing, Yes connects`() = runTest {
        val vm = vm()
        links.value = LinkDecision.Ask(LINK)
        assertEquals(LINK, vm.state.value.confirm)
        assertNull(links.value) // taken from the inbox once
        vm.cancelLink()
        assertNull(vm.state.value.confirm)
        assertTrue(pairing.calls.isEmpty())
        links.value = LinkDecision.Ask(LINK)
        vm.confirmLink()
        assertEquals(listOf("redeem https://box.tail1234.ts.net"), pairing.calls)
    }

    @Test
    fun `an app older than the server says so`() = runTest {
        pairing.redeemFailure = ApiException(426, ApiCodes.UPGRADE_REQUIRED, false)
        val vm = vm()
        vm.submit(CODE)
        assertEquals(ConnectError.AppTooOld, vm.state.value.error)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class LinkViewModelTest : VmTest() {
    @Test
    fun `asks, shows the code while waiting, and connects once the driver types it`() = runTest {
        val pairing = FakePairing()
        val vm = LinkViewModel("http://192.168.1.20:8080", pairing)
        assertEquals(LinkState.Waiting("123456"), vm.state.value)
        assertEquals(listOf("startLink http://192.168.1.20:8080"), pairing.calls)
        pairing.typed.complete(Unit)
        assertEquals(PairingStatus.PAIRED, pairing.statusFlow.value)
    }

    @Test
    fun `an expired or refused code says so, and Get a new code asks again`() = runTest {
        val pairing = FakePairing()
        pairing.awaitFailure = ApiException(410, ApiCodes.LINK_EXPIRED, false)
        val vm = LinkViewModel("http://192.168.1.20:8080", pairing)
        assertEquals(LinkState.Failed(LinkFailure.EXPIRED), vm.state.value)
        pairing.awaitFailure = null
        vm.start()
        assertEquals(LinkState.Waiting("123456"), vm.state.value)
        assertEquals(2, pairing.calls.count { it.startsWith("startLink") })
    }

    @Test
    fun `an older server that cannot link says so`() = runTest {
        val pairing = FakePairing()
        pairing.startFailure = ApiException(404, "not_found", false)
        assertEquals(LinkState.Failed(LinkFailure.NOT_SUPPORTED), LinkViewModel("http://192.168.1.20:8080", pairing).state.value)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class SetupViewModelTest : VmTest() {
    @Test
    fun `shows what the server sent - no vehicle - Check again picks it up - Ready finishes setup`() = runTest {
        val pairing = FakePairing(PairingStatus.PAIRED)
        pairing.setup.value = true
        val data = FakeShiftData()
        data.vehicleList.value = emptyList()
        val vm = SetupViewModel(pairing, data)
        assertEquals("box.tail1234.ts.net", vm.state.value.facts?.host)
        assertEquals(emptyList(), vm.state.value.vehicles)
        data.vehicleList.value = listOf(CIVIC)
        vm.load()
        assertEquals(listOf(CIVIC), vm.state.value.vehicles)
        vm.finish()
        assertEquals(false, pairing.setup.value)
    }

    @Test
    fun `vehicles that could not be loaded are not none yet`() = runTest {
        val data = FakeShiftData()
        data.vehicleList.value = emptyList()
        data.vehiclesOffline = true
        assertNull(SetupViewModel(FakePairing(PairingStatus.PAIRED), data).state.value.vehicles)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class TailscaleViewModelTest : VmTest() {
    @Test
    fun `reads installed and connected, and opens Tailscale`() = runTest {
        val net = FakeNet()
        val vm = TailscaleViewModel(net)
        vm.refresh()
        assertEquals(TailscaleState(installed = false, on = null), vm.state.value)
        net.installed = true
        net.vpn = true
        vm.refresh()
        assertEquals(true, vm.state.value?.ready)
        vm.open()
        assertEquals(1, net.opened)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class SettingsViewModelTest : VmTest() {
    private val pairing = FakePairing(PairingStatus.PAIRED)
    private val net = FakeNet()
    private val data = FakeShiftData()
    private val tracking = FakeTrackingSettings()
    private val looks = FakeAppearance()

    private fun vm() = SettingsViewModel(pairing, net, data, tracking, looks)

    @Test
    fun `shows both host names, the address in use and the connection`() = runTest {
        pairing.whereNow = Where.HOME
        val vm = vm()
        val s = vm.state.value
        assertEquals("192.168.1.20", s.facts?.homeHost)
        assertEquals("box.tail1234.ts.net", s.facts?.awayHost)
        assertEquals(ConnectionCheck.Ok(Where.HOME), s.check)
        assertEquals("http://192.168.1.20:8080", s.helpBase)
    }

    @Test
    fun `Check connection explains a failure with its way forward`() = runTest {
        net.vpn = false
        pairing.whereNow = Where.AWAY
        pairing.checkFailure = ApiException(0, ApiCodes.NETWORK, true)
        val s = vm().state.value
        assertEquals(ConnectionCheck.Failed(ConnectError.Failed(ConnectFailure.TailscaleOff)), s.check)
    }

    @Test
    fun `Help is hidden when the server turned it off`() = runTest {
        pairing.state = pairing.state!!.copy(settings = pairing.state!!.settings!!.copy(helpEnabled = false))
        assertNull(vm().state.value.helpBase)
    }

    @Test
    fun `unpair - asks first, refuses while data waits until the driver confirms, and nothing is lost`() = runTest {
        pairing.unsent = true
        data.sync.value = sendStatus(unsentShifts = 2, unsentFixes = 340)
        val vm = vm()
        val events = collect(vm.events)
        vm.disconnect()
        assertEquals(SettingsEvent.AskUnpair("box.tail1234.ts.net"), events.last())
        vm.confirmDisconnect()
        assertEquals(SettingsEvent.AskLeaveUnsent("box.tail1234.ts.net", 2, 340), events.last())
        assertEquals(PairingStatus.PAIRED, pairing.statusFlow.value)
        vm.confirmDisconnect(confirmed = true)
        assertEquals(SettingsEvent.Disconnected, events.last())
        assertEquals(PairingStatus.UNPAIRED, pairing.statusFlow.value)
        assertEquals(listOf("unpair false", "unpair true"), pairing.calls.filter { it.startsWith("unpair") })
    }

    @Test
    fun `another servers shifts - shown under Sending, connecting is the disconnect question, deleting is counted`() = runTest {
        data.other.value = OtherServerShifts(1, 12, emptyList(), 1_000)
        val vm = vm()
        val events = collect(vm.events)
        assertEquals(1, vm.state.value.otherServer.shifts)
        vm.disconnect()
        assertEquals(SettingsEvent.AskUnpair("box.tail1234.ts.net"), events.last())
        vm.deleteOtherServer()
        assertEquals(SettingsEvent.OtherServerDeleted(1), events.last())
        assertTrue(vm.state.value.otherServer.none)
        assertEquals(listOf("deleteOther"), data.calls)
    }

    @Test
    fun `never unpairs while a shift runs`() = runTest {
        data.running.value = runningView()
        val vm = vm()
        val events = collect(vm.events)
        vm.disconnect()
        assertEquals(listOf<SettingsEvent>(SettingsEvent.EndShiftFirst), events)
        assertTrue(pairing.calls.none { it.startsWith("unpair") })
    }

    @Test
    fun `the drive prompt - on, and a refusal in words with the permission it needs`() = runTest {
        val vm = vm()
        val events = collect(vm.events)
        vm.setDetection(true)
        assertEquals(true, vm.state.value.detection)
        vm.setDetection(false)
        assertEquals(false, vm.state.value.detection)
        tracking.result = DetectionResult.NEEDS_BACKGROUND_LOCATION
        tracking.perm = ALLOWED.copy(backgroundLocation = false)
        vm.setDetection(true)
        assertEquals(false, vm.state.value.detection)
        assertEquals(DetectionOutcome.NEEDS_ALL_THE_TIME, vm.state.value.detectionProblem)
        assertEquals(SettingsEvent.Detection(DetectionOutcome.NEEDS_ALL_THE_TIME), events.last())
        tracking.perm = ALLOWED.copy(locationEnabled = false)
        vm.setDetection(true)
        assertEquals(DetectionOutcome.LOCATION_OFF, vm.state.value.detectionProblem)
    }

    @Test
    fun `the reminder, the theme and wallpaper colours are kept`() = runTest {
        val vm = vm()
        vm.setNudge(0)
        assertEquals(0L, tracking.current.nudgeAfterMs)
        vm.setNudge(45)
        assertEquals(45 * 60_000L, vm.state.value.nudgeMs)
        vm.setTheme(AppTheme.DARK)
        assertEquals(AppTheme.DARK, vm.state.value.theme)
        vm.setWallpaper(true)
        assertEquals(true, vm.state.value.wallpaper)
    }

    @Test
    fun `Send now says whether everything is on the server`() = runTest {
        data.sendDone = false
        val vm = vm()
        val events = collect(vm.events)
        vm.sendNow()
        assertEquals(SettingsEvent.Sent(false), events.last())
        assertEquals("retry", data.calls.last())
        assertIs<SettingsEvent.Sent>(events.last())
    }

    @Test
    fun `waiting counts come from the sending status`() = runTest {
        data.sync.value = sendStatus(unsentShifts = 3, unsentFixes = 12)
        val s = vm().state.value
        assertEquals(3, s.unsentShifts)
        assertEquals(12L, s.unsentFixes)
    }
}
