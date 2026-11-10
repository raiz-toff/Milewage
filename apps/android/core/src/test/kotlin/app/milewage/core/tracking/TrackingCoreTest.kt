package app.milewage.core.tracking

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TrackingCoreTest {
    private val caps = DeviceCapabilities(hasGps = true, hasNetwork = true, hasSignificantMotion = true)

    /** Everything a service has, kept across "process deaths" (a new core over the same stores). */
    private class Stores {
        val fixes = InMemoryFixStore()
        val active = InMemoryActiveShiftStore()
        val settings = InMemoryTrackingSettingsStore()
        val interruptions = InMemoryInterruptionLog()
        val state = InMemoryTrackingStateStore()
        val diag = ArrayList<Pair<String, Map<String, String>>>()

        fun core(caps: DeviceCapabilities) = TrackingCore(fixes, active, settings, interruptions, state, { e, d -> diag += e to d }, caps)
    }

    private val sim = Sim()
    private var elapsed = 10_000_000L

    /** A fix made now on both clocks (no delivery delay). */
    private fun fixNow(provider: String = RawLocation.GPS, accuracy: Float = 6f, speed: Float? = null, gnssAheadMs: Long = 0): RawLocation =
        RawLocation(provider, sim.timeMs + gnssAheadMs, elapsed, sim.lat(sim.northM), sim.lon(sim.eastM), accuracy, speed, null, null)

    private suspend fun TrackingCore.deliver(vararg raws: RawLocation) = onLocations(raws.toList(), sim.timeMs, elapsed)

    private fun advance(ms: Long) {
        sim.timeMs += ms
        elapsed += ms
    }

    private suspend fun TrackingCore.ride(metres: Double, speed: Double = 10.0, everyMs: Long = 5_000): List<TrackingEffect> {
        val out = ArrayList<TrackingEffect>()
        var done = 0.0
        while (done < metres) {
            advance(everyMs)
            sim.northM += speed * everyMs / 1000
            done += speed * everyMs / 1000
            out += deliver(fixNow(speed = speed.toFloat()))
        }
        return out
    }

    private suspend fun TrackingCore.stay(seconds: Int, everyMs: Long = 5_000): List<TrackingEffect> {
        val out = ArrayList<TrackingEffect>()
        var t = 0L
        while (t < seconds * 1000L) {
            advance(everyMs)
            t += everyMs
            out += deliver(fixNow(speed = 0.2f))
            out += onTick(sim.timeMs)
        }
        return out
    }

    private fun List<TrackingEffect>.plans() = filterIsInstance<TrackingEffect.ApplyPlan>().map { it.plan }

    @Test
    fun `nothing to do stops the service`() = runBlocking {
        val s = Stores()
        val out = s.core(caps).start(sim.timeMs)
        assertEquals(TrackingEffect.Stop, out.last())
        assertEquals(listOf(LocationPlan.NONE), out.plans())
    }

    @Test
    fun `a shift stores every GNSS fix with increasing seq, counts the live distance and updates the notification by tenths`() = runBlocking {
        val s = Stores()
        val core = s.core(caps)
        val start = core.startShift(ActiveShift("shift-1", sim.timeMs), sim.timeMs)
        assertEquals(LocationPlan.recording(PowerLevel.FULL, CadenceConfig(), caps), start.plans().single())
        assertTrue(start.any { it is TrackingEffect.ShowShift })
        assertEquals(ActiveShift("shift-1", sim.timeMs), s.active.get())

        val effects = core.ride(2_000.0)
        val stored = s.fixes.fixesFor("shift-1")
        assertEquals(40, stored.size)
        assertEquals(stored.map { it.seq }.sorted(), stored.map { it.seq })
        assertTrue(stored.all { it.provider == "gps" && it.phoneTimeMs != null })
        val status = core.status.value
        assertEquals(TrackingMode.RECORDING, status.mode)
        assertTrue(status.distanceM in 1_950L..2_000L, "live ${status.distanceM}")
        // 2 km in 0.1 km steps: about 20 notification updates for 40 fixes, never one per fix.
        val shows = effects.filterIsInstance<TrackingEffect.ShowShift>().size
        assertTrue(shows in 15..25, "shows $shows")
    }

    @Test
    fun `network positions and passive copies of our own fixes are not stored`() = runBlocking {
        val s = Stores()
        val core = s.core(caps)
        core.startShift(ActiveShift("s", sim.timeMs), sim.timeMs)
        advance(5_000)
        val gps = fixNow()
        core.deliver(gps, fixNow(provider = RawLocation.NETWORK, accuracy = 25f))
        core.deliver(gps) // the passive listener hands the same fix over again
        assertEquals(1, s.fixes.fixesFor("s").size)
    }

    @Test
    fun `still for the timeout drops to the low-power plan, the motion sensor brings full power back`() = runBlocking {
        val s = Stores()
        val core = s.core(caps)
        core.startShift(ActiveShift("s", sim.timeMs), sim.timeMs)
        core.ride(1_000.0)
        val parked = core.stay(160)
        assertEquals(LocationPlan.recording(PowerLevel.LOW, CadenceConfig(), caps), parked.plans().single())
        assertEquals(PowerLevel.LOW, core.status.value.power)
        val woke = core.onSignificantMotion(sim.timeMs)
        assertEquals(PowerLevel.FULL, woke.plans().single().let { if (it.significantMotion) PowerLevel.LOW else PowerLevel.FULL })
        assertEquals(PowerLevel.FULL, core.status.value.power)
        assertTrue(s.diag.any { it.first == "power" && it.second["level"] == "low" })
        assertFalse(s.diag.any { d -> d.second.values.any { v -> v.contains("51.") } }, "no coordinates in diagnostics")
    }

    @Test
    fun `a killed service resumes the same shift with its distance and power, and notes the gap`() = runBlocking {
        val s = Stores()
        val first = s.core(caps)
        first.startShift(ActiveShift("s", sim.timeMs), sim.timeMs)
        first.ride(1_500.0)
        val before = first.status.value.distanceM
        advance(10 * 60_000L) // killed while riding; restarted 10 minutes later
        val second = s.core(caps)
        val out = second.start(sim.timeMs)
        assertEquals(TrackingMode.RECORDING, second.status.value.mode)
        assertEquals(before, second.status.value.distanceM)
        assertEquals(LocationPlan.recording(PowerLevel.FULL, CadenceConfig(), caps), out.plans().single())
        val gap = s.interruptions.list("s").single()
        assertEquals(InterruptionReason.SERVICE_RESTARTED, gap.reason)
        assertTrue(gap.toMs - gap.fromMs in 600_000L..630_000L)
        second.ride(500.0)
        assertTrue(second.status.value.distanceM > before)
    }

    @Test
    fun `a restart while parked in low power is not an interruption and stays in low power`() = runBlocking {
        val s = Stores()
        val first = s.core(caps)
        first.startShift(ActiveShift("s", sim.timeMs), sim.timeMs)
        first.ride(500.0)
        first.stay(200)
        advance(20 * 60_000L)
        val second = s.core(caps)
        val out = second.start(sim.timeMs)
        assertEquals(PowerLevel.LOW, second.status.value.power)
        assertTrue(out.plans().single().significantMotion)
        assertTrue(s.interruptions.list("s").isEmpty())
    }

    @Test
    fun `stopping a shift stops the service, or goes back to watching when detection is on`() = runBlocking {
        val s = Stores()
        val core = s.core(caps)
        core.startShift(ActiveShift("s", sim.timeMs), sim.timeMs)
        core.ride(300.0)
        val stop = core.stopShift(sim.timeMs)
        assertEquals(TrackingEffect.Stop, stop.last())
        assertNull(s.active.get())
        assertEquals(TrackingMode.STOPPED, core.status.value.mode)

        s.settings.set(TrackingSettings(detectionEnabled = true))
        core.startShift(ActiveShift("t", sim.timeMs), sim.timeMs)
        val back = core.stopShift(sim.timeMs)
        assertTrue(back.contains(TrackingEffect.ShowWatching))
        assertEquals(TrackingMode.WATCHING, core.status.value.mode)
        assertEquals(DetectorState.COOLDOWN, core.status.value.detection)
    }

    @Test
    fun `detection prompts on a drive and a start from the prompt keeps the drive's fixes`() = runBlocking {
        val s = Stores()
        val core = s.core(caps)
        val on = core.setDetection(true, sim.timeMs)
        assertTrue(on.contains(TrackingEffect.ShowWatching))
        assertEquals(LocationPlan.watching(WatchPower.IDLE, CadenceConfig(), caps), on.plans().single())
        assertTrue(s.settings.get().detectionEnabled)

        val probe = core.onSignificantMotion(sim.timeMs)
        assertEquals(LocationPlan.watching(WatchPower.PROBE, CadenceConfig(), caps), probe.plans().single())
        val drive = core.ride(1_000.0, speed = 15.0, everyMs = 3_000)
        val prompt = drive.filterIsInstance<TrackingEffect.PostPrompt>().single()
        assertEquals(DetectorState.DETECTED, core.status.value.detection)
        assertTrue(s.fixes.all().isEmpty(), "nothing stored without a shift")

        // The driver taps Start; the app starts its shift at the drive's start and calls startShift.
        val started = core.startShift(ActiveShift("auto", prompt.driveStartedAtMs), sim.timeMs)
        assertTrue(started.contains(TrackingEffect.CancelPrompt))
        val carried = s.fixes.fixesFor("auto")
        assertTrue(carried.size >= 10, "carried ${carried.size}")
        assertTrue(core.status.value.distanceM > 300)
        assertEquals(DetectorState.PAUSED, core.status.value.detection)
    }

    @Test
    fun `not now goes back to the cheap watch`() = runBlocking {
        val s = Stores()
        val core = s.core(caps)
        core.setDetection(true, sim.timeMs)
        core.onSignificantMotion(sim.timeMs)
        core.ride(1_000.0, speed = 15.0, everyMs = 3_000)
        val out = core.notNow(sim.timeMs)
        assertTrue(out.contains(TrackingEffect.CancelPrompt))
        assertEquals(LocationPlan.watching(WatchPower.IDLE, CadenceConfig(), caps), out.plans().single())
        val off = core.setDetection(false, sim.timeMs)
        assertEquals(TrackingEffect.Stop, off.last())
    }

    @Test
    fun `a restarted watcher with the prompt up posts it again`() = runBlocking {
        val s = Stores()
        val first = s.core(caps)
        first.setDetection(true, sim.timeMs)
        first.onSignificantMotion(sim.timeMs)
        first.ride(1_000.0, speed = 15.0, everyMs = 3_000)
        val again = s.core(caps).start(sim.timeMs)
        assertTrue(again.any { it is TrackingEffect.PostPrompt })
        assertEquals(LocationPlan.watching(WatchPower.DETECTED, CadenceConfig(), caps), again.plans().single())
    }

    @Test
    fun `location off during a shift becomes an interruption when it comes back`() = runBlocking {
        val s = Stores()
        val core = s.core(caps)
        core.startShift(ActiveShift("s", sim.timeMs), sim.timeMs)
        val from = sim.timeMs
        core.locationAvailability(false, InterruptionReason.LOCATION_OFF, from)
        assertEquals(TrackingProblem.LOCATION_OFF, core.status.value.problem)
        core.locationAvailability(false, InterruptionReason.LOCATION_OFF, from + 1_000) // repeated: one span
        core.locationAvailability(true, InterruptionReason.LOCATION_OFF, from + 90_000)
        assertEquals(listOf(Interruption(from, from + 90_000, InterruptionReason.LOCATION_OFF)), s.interruptions.list("s"))
        assertNull(core.status.value.problem)
    }

    @Test
    fun `the GNSS offset is measured on GNSS fixes and goes stale after 10 minutes`() = runBlocking {
        val s = Stores()
        val core = s.core(caps)
        core.startShift(ActiveShift("s", sim.timeMs), sim.timeMs)
        advance(5_000)
        core.deliver(fixNow(gnssAheadMs = 1_500))
        assertEquals(1_500L, core.status.value.freshGnssOffsetMs(sim.timeMs))
        assertNull(core.status.value.freshGnssOffsetMs(sim.timeMs + 600_001))
        assertEquals(-1_500L, ClockSkew.medianPhoneMinusGnssMs(s.fixes.fixesFor("s")))
    }

    @Test
    fun `a failing fix store never stops the service`() = runBlocking {
        val s = Stores()
        val broken = object : FixStore {
            override suspend fun append(shiftClientId: String, fixes: List<RecordedFix>): List<RecordedFix> = error("disk full")
            override suspend fun fixesFor(shiftClientId: String): List<RecordedFix> = error("disk full")
            override suspend fun lastSeq(shiftClientId: String): Long? = null
        }
        val core = TrackingCore(broken, s.active, s.settings, s.interruptions, s.state, { e, d -> s.diag += e to d }, caps)
        core.startShift(ActiveShift("s", sim.timeMs), sim.timeMs)
        core.ride(200.0)
        assertTrue(s.diag.any { it.first == "storage_error" && it.second["op"] == "append_fixes" })
        assertEquals(TrackingMode.RECORDING, core.status.value.mode)
    }

    @Test
    fun `the app's notification details show at once and survive a restart`() = runBlocking {
        val s = Stores()
        val core = s.core(caps)
        val at = sim.timeMs
        core.startShift(ActiveShift("s", at), at)
        val shown = core.setNotice(ShiftNotice(startedAt = at, footer = "Started 09:02 · Bike")).filterIsInstance<TrackingEffect.ShowShift>().single()
        assertEquals("Started 09:02 · Bike", shown.text.text)
        val again = s.core(caps).start(sim.timeMs).filterIsInstance<TrackingEffect.ShowShift>().single()
        assertEquals("Started 09:02 · Bike", again.notice.footer)
    }

    @Test
    fun `starting the same shift twice is harmless`() = runBlocking {
        val s = Stores()
        val core = s.core(caps)
        core.startShift(ActiveShift("s", sim.timeMs), sim.timeMs)
        core.ride(500.0)
        val d = core.status.value.distanceM
        core.startShift(ActiveShift("s", sim.timeMs), sim.timeMs)
        assertEquals(d, core.status.value.distanceM)
    }
}
