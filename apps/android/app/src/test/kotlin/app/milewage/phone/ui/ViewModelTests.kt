@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package app.milewage.phone.ui

import app.milewage.core.pairing.LinkDecision
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.shift.EditResult
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.StartResult
import app.milewage.core.sync.OtherServerShifts
import app.milewage.core.sync.Reminder
import app.milewage.core.sync.ShiftMarker
import app.milewage.core.sync.StatusColor
import app.milewage.data.ShiftListItem
import app.milewage.phone.logic.BannerKind
import app.milewage.phone.logic.DiagnosticsInfo
import app.milewage.phone.logic.DiagnosticsSource
import app.milewage.phone.logic.EditOutcome
import app.milewage.phone.logic.OdometerAsk
import app.milewage.phone.logic.StartProblem
import app.milewage.phone.logic.TrackingLine
import app.milewage.phone.logic.TripChoice
import app.milewage.phone.logic.VehicleSource
import app.milewage.phone.platform.PairLinkInbox
import app.milewage.phone.support.ALLOWED
import app.milewage.phone.support.CIVIC
import app.milewage.phone.support.FakeShiftData
import app.milewage.phone.support.FakeTracking
import app.milewage.phone.support.FixedNow
import app.milewage.phone.support.NOW
import app.milewage.phone.support.VAN
import app.milewage.phone.support.detail
import app.milewage.phone.support.recording
import app.milewage.phone.support.runningView
import app.milewage.phone.support.sendStatus
import app.milewage.phone.support.shift
import app.milewage.phone.ui.detail.DetailEvent
import app.milewage.phone.ui.detail.EditWhat
import app.milewage.phone.ui.detail.ShiftDetailViewModel
import app.milewage.phone.ui.diagnostics.DiagnosticsViewModel
import app.milewage.phone.ui.home.HomeEvent
import app.milewage.phone.ui.home.HomeViewModel
import app.milewage.phone.ui.home.Period
import app.milewage.phone.ui.nav.AppViewModel
import app.milewage.phone.logic.Gate
import app.milewage.phone.support.FakePairing
import app.milewage.phone.ui.shifts.ShiftsEvent
import app.milewage.phone.ui.shifts.ShiftsViewModel
import app.milewage.core.connect.Where
import app.milewage.core.tracking.TrackingStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** View models run on the JVM with fakes; `viewModelScope` uses the test dispatcher as Main. */
@OptIn(ExperimentalCoroutinesApi::class)
abstract class VmTest {
    @Before
    fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun reset() = Dispatchers.resetMain()

    /** Collects [flow] for the test (a screen subscribed) and returns what it emitted, in order. */
    fun <T> TestScope.collect(flow: Flow<T>): MutableList<T> {
        val seen = mutableListOf<T>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { flow.collect { seen += it } }
        return seen
    }
}

class HomeViewModelTest : VmTest() {
    private val data = FakeShiftData()
    private val tracking = FakeTracking()

    private fun TestScope.home(): Pair<HomeViewModel, MutableList<HomeEvent>> {
        val vm = HomeViewModel(data, tracking, FixedNow())
        collect(vm.state)
        val events = collect(vm.event)
        return vm to events
    }

    @Test
    fun `another servers shifts show apart and are deleted only when asked`() = runTest {
        val (vm, events) = home()
        assertTrue(vm.state.value.otherServer.none)
        data.other.value = OtherServerShifts(2, 340, listOf("old.example.ts.net"), NOW - 5 * 86_400_000L)
        assertEquals(2, vm.state.value.otherServer.shifts)
        assertTrue(data.calls.none { it == "deleteOther" })
        vm.deleteOtherServer()
        advanceUntilIdle()
        assertEquals(HomeEvent.OtherServerDeleted(2), events.last())
        assertTrue(vm.state.value.otherServer.none)
        data.failDelete = true
        vm.deleteOtherServer()
        advanceUntilIdle()
        assertEquals(HomeEvent.DeleteFailed, events.last())
    }

    @Test
    fun `shows the summary, the banner and the vehicle from the server`() = runTest {
        data.sync.value = sendStatus(StatusColor.YELLOW, 1, 40, NOW - 1_000)
        val (vm, _) = home()
        val s = vm.state.value
        assertTrue(s.ready)
        assertEquals(42_100, s.summary!!.week.totalM)
        assertEquals(BannerKind.WAITING, s.banner!!.kind)
        assertEquals(VehicleSource.SERVER, s.vehicles.source)
        assertEquals(CIVIC.id, s.vehicles.selectedId)
        assertNull(s.running)
        vm.selectPeriod(Period.MONTH)
        assertEquals(Period.MONTH, vm.state.value.period)
    }

    @Test
    fun `starts with the chosen vehicle and shows the running shift`() = runTest {
        data.vehicleList.value = listOf(CIVIC, VAN)
        data.lastVehicle = CIVIC.id
        val (vm, events) = home()
        assertEquals(CIVIC.id, vm.state.value.vehicles.selectedId)
        vm.selectVehicle(VAN.id)
        vm.start()
        advanceUntilIdle()
        assertEquals("start 4 -", data.calls.last { it.startsWith("start") })
        assertNotNull(vm.state.value.running)
        assertTrue(events.isEmpty())
    }

    @Test
    fun `refuses to start without location and names the switch first, writing nothing`() = runTest {
        tracking.perm = ALLOWED.copy(locationEnabled = false)
        val (vm, events) = home()
        vm.start()
        assertEquals(HomeEvent.StartRefused(StartProblem.LOCATION_OFF), events.single())
        tracking.perm = ALLOWED.copy(preciseLocation = false)
        vm.start()
        assertEquals(HomeEvent.StartRefused(StartProblem.NO_PERMISSION), events.last())
        assertTrue(data.calls.none { it.startsWith("start") })
    }

    @Test
    fun `no vehicle list at all says why and offers to load it again`() = runTest {
        data.vehicleList.value = emptyList()
        data.vehiclesFail = true
        val (vm, events) = home()
        assertEquals(VehicleSource.KEPT, vm.state.value.vehicles.source)
        vm.start()
        assertEquals(HomeEvent.StartRefused(StartProblem.VEHICLES_NOT_LOADED), events.single())
        data.vehiclesFail = false
        data.vehicleList.value = listOf(CIVIC)
        vm.loadVehicles()
        assertEquals(VehicleSource.SERVER, vm.state.value.vehicles.source)
        assertEquals(CIVIC.id, vm.state.value.vehicles.selectedId)
    }

    @Test
    fun `offline vehicles are the kept copy and a shift still starts`() = runTest {
        data.vehiclesOffline = true
        val (vm, _) = home()
        assertEquals(VehicleSource.KEPT, vm.state.value.vehicles.source)
        vm.start()
        assertNotNull(vm.state.value.running)
    }

    @Test
    fun `the tracker refused and a failure are each a message with a way forward`() = runTest {
        data.startResult = StartResult.RecorderRefused
        val (vm, events) = home()
        vm.start()
        assertEquals(HomeEvent.StartRefused(StartProblem.TRACKER_REFUSED), events.last())
        data.startResult = null
        data.failStart = true
        vm.start()
        assertEquals(HomeEvent.StartRefused(StartProblem.FAILED), events.last())
        assertNull(vm.state.value.busy)
        data.pairing.value = PairingStatus.UNPAIRED
        data.failStart = false
        vm.start()
        assertEquals(HomeEvent.StartRefused(StartProblem.NOT_PAIRED), events.last())
    }

    @Test
    fun `an odometer check due asks for the start reading, a bad number keeps the dialog open`() = runTest {
        data.due = true
        val (vm, events) = home()
        vm.start()
        assertEquals(OdometerAsk.AtStart(CIVIC.id), vm.state.value.odometer)
        assertTrue(data.calls.none { it.startsWith("start") })
        vm.saveOdometer("twelve")
        assertEquals(HomeEvent.OdometerInvalid, events.last())
        assertNotNull(vm.state.value.odometer)
        vm.saveOdometer("45,210")
        assertEquals("start 3 45210000", data.calls.last { it.startsWith("start") })
        assertNull(vm.state.value.odometer)
    }

    @Test
    fun `start without the reading`() = runTest {
        data.due = true
        val (vm, _) = home()
        vm.start()
        vm.skipOdometer()
        assertEquals("start 3 -", data.calls.last { it.startsWith("start") })
    }

    @Test
    fun `ending sends at once, says where the shift is, then asks the end reading when due`() = runTest {
        data.running.value = runningView()
        data.details.value = mapOf("run" to detail(shift("run")))
        data.sendDone = false
        data.due = false
        val (vm, events) = home()
        vm.end()
        advanceUntilIdle()
        assertEquals(HomeEvent.Ended("run", sent = false), events.first())
        assertTrue("sendNow" in data.calls)
        // A start reading was given: the end reading is asked to pair with it.
        assertEquals(OdometerAsk.AtEnd("run", CIVIC.id), vm.state.value.odometer)
        vm.saveOdometer("45300")
        assertTrue("odometer run SHIFT_END 45300000" in data.calls)
        assertTrue("checked 3" in data.calls)
        assertEquals(HomeEvent.OdometerSaved, events.last())
        assertNull(vm.state.value.running)
        assertNull(vm.state.value.busy)
    }

    @Test
    fun `not now on the end reading counts as checked`() = runTest {
        data.running.value = runningView()
        data.due = true
        val (vm, events) = home()
        vm.end()
        advanceUntilIdle()
        assertEquals(HomeEvent.Ended("run", sent = true), events.first())
        vm.dismissOdometer()
        assertNull(vm.state.value.odometer)
        assertTrue("checked 3" in data.calls)
    }

    @Test
    fun `the running shift's state in words follows the tracker, and resume brings it back`() = runTest {
        data.running.value = runningView()
        val (vm, events) = home()
        assertEquals(TrackingLine.STARTING, vm.state.value.trackingLine)
        vm.onResume()
        assertEquals(1, tracking.ensured)
        assertEquals(TrackingLine.NOT_RECORDING, vm.state.value.trackingLine)
        tracking.resumes = false
        vm.resumeRecording()
        assertEquals(HomeEvent.ResumeFailed, events.last())
        tracking.resumes = true
        vm.resumeRecording()
        assertEquals(TrackingLine.RECORDING, vm.state.value.trackingLine)
        tracking.status.value = recording("run", app.milewage.core.tracking.PowerLevel.LOW)
        assertEquals(TrackingLine.SAVING_BATTERY, vm.state.value.trackingLine)
    }

    @Test
    fun `a shift that stopped recording can be ended at its last point`() = runTest {
        data.running.value = runningView()
        tracking.status.value = TrackingStatus()
        val (vm, events) = home()
        vm.closeUnfinished()
        advanceUntilIdle()
        assertTrue("close" in data.calls)
        assertIs<HomeEvent.Ended>(events.first())
    }

    @Test
    fun `pull to refresh sends, something still waiting is said`() = runTest {
        data.sync.value = sendStatus(StatusColor.YELLOW, 2, 300, NOW)
        data.sendDone = false
        val (vm, events) = home()
        vm.refresh()
        advanceUntilIdle()
        assertTrue("sendNow" in data.calls)
        assertTrue("refreshVehicles" in data.calls)
        assertEquals(HomeEvent.StillWaiting, events.last())
        assertTrue(!vm.state.value.refreshing)
        vm.sendNow()
        assertTrue("retry" in data.calls)
        vm.stopSending()
        assertTrue("cancel" in data.calls)
    }

    @Test
    fun `the banner's reminder is noted once`() = runTest {
        val (vm, _) = home()
        vm.reminderShown(Reminder.Level.NONE)
        vm.reminderShown(Reminder.Level.NORMAL)
        vm.reminderShown(Reminder.Level.NORMAL)
        assertEquals(1, data.calls.count { it == "reminderShown" })
    }

    @Test
    fun `Start shift does nothing while a shift runs`() = runTest {
        data.running.value = runningView()
        val (vm, events) = home()
        vm.start()
        assertEquals(0, data.calls.count { it.startsWith("start") })
        assertTrue(events.isEmpty())
        assertNull(vm.state.value.busy)
    }
}

class ShiftsViewModelTest : VmTest() {
    private val data = FakeShiftData()

    @Test
    fun `groups by week, pages by the facade's limit, and refresh sends`() = runTest {
        data.list.value = (0 until 250).map { i ->
            ShiftListItem(shift("s$i", startedAt = NOW - i * 3_600_000L, localDate = "2026-11-10"), ShiftMarker.SENT, CIVIC)
        }
        data.sendDone = false
        val vm = ShiftsViewModel(data, FixedNow())
        collect(vm.state)
        val events = collect(vm.event)
        assertTrue(vm.state.value.loaded)
        assertEquals(200, vm.state.value.groups.sumOf { it.rows.size })
        assertTrue(vm.state.value.hasMore)
        vm.showOlder()
        assertEquals(250, vm.state.value.groups.sumOf { it.rows.size })
        assertTrue(!vm.state.value.hasMore)
        vm.refresh()
        advanceUntilIdle()
        assertEquals(ShiftsEvent.StillWaiting, events.single())
    }

    @Test
    fun `an empty list is loaded and empty, not loading`() = runTest {
        val vm = ShiftsViewModel(data, FixedNow())
        collect(vm.state)
        assertTrue(vm.state.value.loaded)
        assertTrue(vm.state.value.groups.isEmpty())
    }
}

class ShiftDetailViewModelTest : VmTest() {
    private val data = FakeShiftData().apply { details.value = mapOf("s1" to detail()) }

    private fun TestScope.vm(): Pair<ShiftDetailViewModel, MutableList<DetailEvent>> {
        val vm = ShiftDetailViewModel("s1", data)
        collect(vm.state)
        return vm to collect(vm.event)
    }

    @Test
    fun `shows the shift with its flags and the server's changes, a missing one is gone`() = runTest {
        val (vm, _) = vm()
        assertNotNull(vm.state.value.detail)
        assertTrue(vm.state.value.editable)
        data.details.value = emptyMap()
        assertTrue(vm.state.value.loaded)
        assertNull(vm.state.value.detail)
    }

    @Test
    fun `a trip changes purpose and kind, an empty purpose is refused before it is queued`() = runTest {
        val (vm, events) = vm()
        val t = vm.state.value.detail!!.trips[0]
        vm.editTrip(t, TripChoice.PERSONAL, "  School run ")
        assertEquals("editTrip t1 PERSONAL School run", data.calls.last())
        assertEquals(DetailEvent.Saved(EditWhat.TRIP_CHANGED), events.last())
        vm.editTrip(t, TripChoice.BUSINESS, "   ")
        assertEquals(DetailEvent.PurposeInvalid, events.last())
        assertEquals(1, data.calls.count { it.startsWith("editTrip") })
    }

    @Test
    fun `an added trip needs a distance above 0, without a purpose the facade gives it one`() = runTest {
        val (vm, events) = vm()
        vm.addTrip("0", TripChoice.BUSINESS, "")
        assertEquals(DetailEvent.DistanceInvalid, events.last())
        vm.addTrip("abc", TripChoice.BUSINESS, "")
        assertEquals(DetailEvent.DistanceInvalid, events.last())
        vm.addTrip("12.5", TripChoice.BUSINESS, "")
        assertEquals("addTrip s1 ACTIVE 12500 null", data.calls.last())
        vm.addTrip("3", TripChoice.PERSONAL, "Lunch")
        assertEquals("addTrip s1 PERSONAL 3000 Lunch", data.calls.last())
        assertEquals(DetailEvent.Saved(EditWhat.TRIP_ADDED), events.last())
    }

    @Test
    fun `odometer, notes, and the server's refusals in words`() = runTest {
        val (vm, events) = vm()
        vm.setOdometer(OdometerKind.SHIFT_END, "45,300")
        assertEquals("odometer s1 SHIFT_END 45300000", data.calls.last())
        vm.setOdometer(OdometerKind.SHIFT_END, "lots")
        assertEquals(DetailEvent.OdometerInvalid, events.last())
        data.editResult = EditResult.Refused(EditResult.Reason.FINALIZED)
        vm.setNotes(" Rain all day ")
        assertEquals("notes s1 Rain all day", data.calls.last())
        assertEquals(DetailEvent.Refused(EditOutcome.FINALIZED), events.last())
    }

    @Test
    fun `dismissing a change notice marks it seen, Send now retries`() = runTest {
        data.sendDone = false
        val (vm, events) = vm()
        vm.dismissOverwrite(5)
        assertTrue("seen 5" in data.calls)
        vm.sendNow()
        assertTrue("retry" in data.calls)
        assertEquals(DetailEvent.StillWaiting, events.last())
    }
}

class DiagnosticsViewModelTest : VmTest() {
    @Test
    fun `runs the maths check and reads the states`() = runTest {
        val info = DiagnosticsInfo("0.3.0", 3, "debug", 4, "16", 36, "Pixel", PairingStatus.PAIRED, Where.AWAY, null, "box.ts.net", TrackingStatus(), ALLOWED, 0, 0, null)
        val source = object : DiagnosticsSource {
            override suspend fun snapshot() = info

            override fun selfCheck() = emptyList<String>()
        }
        val vm = DiagnosticsViewModel(source)
        val s = vm.state.first { it.selfCheck != null }
        assertEquals(emptyList(), s.selfCheck)
        assertTrue("Maths check: passed" in s.summary!!)
    }
}

class AppViewModelTest : VmTest() {
    @Test
    fun `the gate follows pairing, setup, a running shift, and links wait in the inbox`() = runTest {
        val data = FakeShiftData()
        data.pairing.value = PairingStatus.UNPAIRED
        val pairing = FakePairing()
        val inbox = PairLinkInbox(status = { PairingStatus.UNPAIRED })
        val vm = AppViewModel(data, pairing, inbox)
        assertEquals(Gate.FIRST_RUN, vm.shell.value.gate)
        data.pairing.value = PairingStatus.REVOKED
        data.running.value = runningView()
        assertEquals(Gate.MAIN, vm.shell.value.gate)
        assertEquals(PairingStatus.REVOKED, vm.shell.value.status)
        data.running.value = null
        assertEquals(Gate.FIRST_RUN, vm.shell.value.gate)
        // A first connection: the setup steps, then the app once the driver finishes them.
        pairing.setup.value = true
        data.pairing.value = PairingStatus.PAIRED
        assertEquals(Gate.SETUP, vm.shell.value.gate)
        pairing.finishSetup()
        assertEquals(Gate.MAIN, vm.shell.value.gate)
        inbox.receive("milewage://pair?v=1&t=x")
        assertIs<LinkDecision.NotAPairingCode>(vm.link.value)
        vm.consumeLink()
        assertNull(vm.link.value)
    }
}
