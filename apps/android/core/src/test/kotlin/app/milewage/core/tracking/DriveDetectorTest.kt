package app.milewage.core.tracking

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The prompt detector. The reference detector's tests that still apply (real drive, sparse idle
 * displacement, stale idle anchor, parked jitter with a wild network fix, a single speed spike,
 * a drive whose fixes stop, snapshot and restore) are ported; the rest is the prompt's own
 * behaviour: cooldown, cycling, walking, running, tunnels, glitches and process death.
 */
class DriveDetectorTest {
    private class Run(config: DetectorConfig = DetectorConfig(), seed: Int = 42) {
        val sim = Sim(seed)
        var d = DriveDetector(config).also { it.enable(sim.timeMs) }
        val events = ArrayList<DetectorEvent>()

        fun fix(s: Sample = sim.sample()) {
            events += d.onFix(s)
        }

        fun tick() {
            events += d.onTick(sim.timeMs)
        }

        fun motion() {
            events += d.onSignificantMotion(sim.timeMs)
        }

        /** Standing still with GPS jitter, a fix every [intervalS]. */
        fun park(seconds: Int, intervalS: Int = 3, jitterM: Double = 6.0, accuracy: Float = 12f, provider: String = RawLocation.GPS) {
            var t = 0
            while (t < seconds) {
                sim.timeMs += intervalS * 1000L
                t += intervalS
                fix(sim.sample(accuracy = accuracy, speed = if (provider == RawLocation.GPS) sim.randomSpeed(0.8) else null, jitterM = jitterM, provider = provider))
                tick()
            }
        }

        /** Moving north at [speedMps], a fix every [intervalS]. */
        fun move(metres: Double, speedMps: Double, intervalS: Int = 3, reportSpeed: Boolean = true, accuracy: Float = 8f) {
            var done = 0.0
            while (done < metres) {
                val step = minOf(speedMps * intervalS, metres - done)
                sim.northM += step
                done += step
                sim.timeMs += intervalS * 1000L
                fix(sim.sample(accuracy = accuracy, speed = if (reportSpeed) speedMps.toFloat() else null))
                tick()
            }
        }

        /** No fixes, only ticks. */
        fun silence(seconds: Int, everyS: Int = 15) {
            var t = 0
            while (t < seconds) {
                sim.timeMs += everyS * 1000L
                t += everyS
                tick()
            }
        }

        val prompts get() = events.filterIsInstance<DetectorEvent.Prompt>()
        val withdrawn get() = events.filterIsInstance<DetectorEvent.WithdrawPrompt>()
        val probes get() = events.filterIsInstance<DetectorEvent.Probe>().filter { it.started }
        val probeEnds get() = events.filterIsInstance<DetectorEvent.Probe>().filter { !it.started }
    }

    // ---------------------------------------------------------- cars

    @Test
    fun `a car drive is confirmed within seconds of moving off, and the start is the departure`() {
        val r = Run()
        r.park(60, intervalS = 60, provider = RawLocation.NETWORK, accuracy = 30f)
        r.motion()
        assertEquals(DetectorState.PROBING, r.d.state)
        assertEquals(WatchPower.PROBE, r.d.power)
        r.park(20) // the probe sees the car still for a moment
        val departed = r.sim.timeMs
        r.move(1_000.0, speedMps = 15.0)
        assertEquals(1, r.prompts.size)
        assertEquals(DetectorState.DETECTED, r.d.state)
        assertEquals(WatchPower.DETECTED, r.d.power)
        val start = r.prompts.single().driveStartedAtMs
        assertTrue(start - departed in 0..6_000, "starts at the first moving fix")
    }

    @Test
    fun `sparse idle fixes start a probe from displacement, a fast one even during a backoff`() {
        val r = Run()
        r.fix(r.sim.sample(accuracy = 30f, provider = RawLocation.NETWORK))
        r.sim.timeMs += 60_000
        r.fix(r.sim.sample(accuracy = 30f, provider = RawLocation.NETWORK))
        assertTrue(r.probes.isEmpty())
        r.sim.northM += 600.0 // 600 m in the 60 s since it was last seen still: 36 km/h
        r.sim.timeMs += 60_000
        r.fix(r.sim.sample(accuracy = 30f, provider = RawLocation.NETWORK))
        assertEquals("idle_fast_move", r.probes.single().reason)
        r.silence(75) // the probe finds nothing (a tunnel): backoff
        assertEquals(DetectorState.IDLE, r.d.state)
        r.sim.timeMs += 60_000
        r.fix(r.sim.sample(accuracy = 30f, provider = RawLocation.NETWORK))
        r.sim.northM += 900.0 // 900 m in 60 s: 54 km/h
        r.sim.timeMs += 60_000
        r.fix(r.sim.sample(accuracy = 30f, provider = RawLocation.NETWORK))
        assertEquals("idle_fast_move", r.probes.last().reason)
    }

    @Test
    fun `a stale idle anchor asks for a probe instead of prompting`() {
        val r = Run()
        r.fix(r.sim.sample(accuracy = 20f, provider = RawLocation.NETWORK))
        r.sim.timeMs += 8 * 3600_000L
        r.sim.northM += 150.0
        r.fix(r.sim.sample(accuracy = 20f, provider = RawLocation.NETWORK))
        assertTrue(r.prompts.isEmpty())
        assertEquals("idle_move", r.probes.single().reason)
    }

    @Test
    fun `a nav app's fast passive fix starts a probe at once`() {
        val r = Run()
        r.fix(r.sim.sample(accuracy = 5f, speed = 20f))
        assertEquals("reported_speed", r.probes.single().reason)
    }

    // ------------------------------------------------- not a drive

    @Test
    fun `GPS jitter while parked, and a wild network fix, never prompt`() {
        val r = Run()
        r.park(2 * 3600, intervalS = 60, jitterM = 15.0, accuracy = 20f, provider = RawLocation.NETWORK)
        r.motion() // someone bumps the phone
        r.park(5 * 60, intervalS = 3, jitterM = 12.0, accuracy = 15f)
        r.sim.northM += 300.0
        r.sim.timeMs += 30_000
        r.fix(r.sim.sample(accuracy = 400f, provider = RawLocation.NETWORK))
        r.sim.northM -= 300.0
        r.park(10 * 60, intervalS = 60, jitterM = 15.0, accuracy = 20f, provider = RawLocation.NETWORK)
        assertTrue(r.prompts.isEmpty())
        assertEquals("not_moving", r.probeEnds.first().reason)
        assertEquals(DetectorState.IDLE, r.d.state)
    }

    @Test
    fun `a single speed spike does not prompt`() {
        val r = Run()
        r.motion()
        r.park(30)
        r.sim.timeMs += 3000
        r.fix(r.sim.sample(speed = 9f, jitterM = 5.0))
        r.park(120)
        assertTrue(r.prompts.isEmpty())
    }

    @Test
    fun `a GPS glitch out and back with good accuracy does not look like two fast steps`() {
        val r = Run()
        r.motion()
        r.park(30)
        r.sim.timeMs += 5_000
        r.sim.northM += 300.0 // 60 m/s: plausible for one step
        r.fix(r.sim.sample(accuracy = 10f))
        r.sim.timeMs += 5_000
        r.sim.northM -= 300.0
        r.fix(r.sim.sample(accuracy = 10f))
        r.park(30)
        assertTrue(r.prompts.isEmpty())
    }

    @Test
    fun `poor accuracy alone never confirms a drive`() {
        val r = Run()
        r.motion()
        r.move(2_000.0, speedMps = 15.0, accuracy = 80f)
        assertTrue(r.prompts.isEmpty())
        assertEquals("no_fix", r.probeEnds.first().reason)
        assertTrue(r.probes.size <= 3, "strong idle evidence retries, but not without end")
    }

    @Test
    fun `walking never prompts, and repeated failed probes back off`() {
        val r = Run()
        r.motion()
        r.move(300.0, speedMps = 1.4, intervalS = 3)
        assertTrue(r.prompts.isEmpty())
        assertEquals(1, r.probeEnds.size)
        r.motion() // still within the first 3 minute backoff
        assertEquals(DetectorState.IDLE, r.d.state)
        r.silence(3 * 60)
        r.motion()
        assertEquals(DetectorState.PROBING, r.d.state)
        r.move(300.0, speedMps = 1.4)
        assertEquals(2, r.probeEnds.size)
        r.silence(3 * 60)
        r.motion()
        assertEquals(DetectorState.IDLE, r.d.state, "the second backoff is 6 minutes")
        r.silence(3 * 60)
        r.motion()
        assertEquals(DetectorState.PROBING, r.d.state)
    }

    @Test
    fun `jogging at 12 km per hour for 10 minutes does not prompt`() {
        val r = Run()
        r.motion()
        r.move(2_000.0, speedMps = 12 / 3.6)
        assertTrue(r.prompts.isEmpty())
        assertEquals("too_long", r.probeEnds.single().reason)
    }

    // ------------------------------------------------- bicycles

    @Test
    fun `city cycling at 18 km per hour with a red light every 400 m prompts within about 4 minutes`() {
        val r = Run()
        r.motion()
        val set = r.sim.timeMs
        repeat(6) {
            r.move(400.0, speedMps = 5.0, intervalS = 3)
            r.park(30)
        }
        assertEquals(1, r.prompts.size)
        val confirmedAfter = r.events.indexOfFirst { it is DetectorEvent.Prompt }.let { r.d.driveStartedAtMs }
        assertTrue(confirmedAfter - set < 10_000, "the start reaches back across the red lights to the first pedal stroke")
        assertTrue(r.d.bufferedSince(0).first().atMs <= set + 3_000)
    }

    @Test
    fun `a scooter at 22 km per hour without a reported speed is confirmed by the sustained rule`() {
        val r = Run()
        r.motion()
        r.move(1_600.0, speedMps = 22 / 3.6, intervalS = 5, reportSpeed = false)
        assertEquals(1, r.prompts.size)
        assertEquals(DetectorState.DETECTED, r.d.state)
    }

    // --------------------------------------------- tunnels and stops

    @Test
    fun `a tunnel with the prompt up does not withdraw it before 10 minutes without fixes`() {
        val r = Run(DetectorConfig(promptHoldMs = 60 * 60_000L))
        r.motion()
        r.move(1_000.0, speedMps = 15.0)
        assertEquals(1, r.prompts.size)
        r.silence(9 * 60)
        assertTrue(r.withdrawn.isEmpty())
        r.move(500.0, speedMps = 15.0)
        r.silence(10 * 60 + 15)
        assertEquals(DetectorEvent.WithdrawPrompt.Reason.DRIVE_ENDED, r.withdrawn.single().reason)
    }

    @Test
    fun `a probe in a tunnel ends when no fix comes`() {
        val r = Run()
        r.motion()
        r.silence(75)
        assertEquals("no_fix", r.probeEnds.single().reason)
    }

    @Test
    fun `the prompt comes down when the drive ends unanswered, and the next drive waits for the quiet hour`() {
        val r = Run()
        r.motion()
        r.move(2_000.0, speedMps = 15.0)
        r.park(5 * 60 + 10)
        assertEquals(DetectorEvent.WithdrawPrompt.Reason.DRIVE_ENDED, r.withdrawn.single().reason)
        assertEquals(DetectorState.COOLDOWN, r.d.state)
        r.motion()
        r.move(2_000.0, speedMps = 15.0)
        assertEquals(1, r.prompts.size, "no second prompt inside the quiet hour")
    }

    @Test
    fun `an unanswered prompt comes down after 15 minutes`() {
        val r = Run()
        r.motion()
        r.move(15_000.0, speedMps = 15.0)
        assertEquals(DetectorEvent.WithdrawPrompt.Reason.NO_ANSWER, r.withdrawn.single().reason)
        assertEquals(DetectorState.COOLDOWN, r.d.state)
    }

    // ------------------------------------------------ the answer

    @Test
    fun `not now quiets the rest of this drive and the next hour, then a new drive prompts again`() {
        val r = Run()
        r.motion()
        r.move(1_000.0, speedMps = 15.0)
        r.d.notNow(r.sim.timeMs)
        assertEquals(DetectorState.COOLDOWN, r.d.state)
        assertEquals(WatchPower.IDLE, r.d.power, "back to the cheap watch")
        // The same drive goes on for 30 minutes on sparse network fixes: no prompt.
        r.move(30_000.0, speedMps = 15.0, intervalS = 60, accuracy = 40f)
        assertEquals(1, r.prompts.size)
        // Parked 40 minutes: the drive has ended, but the quiet hour is not over yet.
        r.park(40 * 60, intervalS = 60, accuracy = 30f, provider = RawLocation.NETWORK)
        assertEquals(DetectorState.IDLE, r.d.state)
        r.motion()
        r.move(1_000.0, speedMps = 15.0)
        assertEquals(2, r.prompts.size)
    }

    @Test
    fun `a shift started from the prompt carries the drive's fixes and pauses the detector`() {
        val r = Run()
        r.motion()
        r.move(100.0, speedMps = 1.2) // the walk to the car
        val departed = r.sim.timeMs
        r.move(1_000.0, speedMps = 15.0)
        val start = r.prompts.single().driveStartedAtMs
        assertTrue(start >= departed)
        val carried = r.d.bufferedSince(start)
        assertTrue(carried.isNotEmpty())
        assertTrue(carried.all { it.atMs >= start }, "not the walk to the car")
        assertEquals(DetectorEvent.WithdrawPrompt.Reason.NO_ANSWER, (r.d.shiftStarted().single() as DetectorEvent.WithdrawPrompt).reason)
        assertEquals(DetectorState.PAUSED, r.d.state)
        assertEquals(WatchPower.NONE, r.d.power)
        assertTrue(r.d.bufferedSince(0).isEmpty())
        r.move(1_000.0, speedMps = 15.0)
        assertEquals(1, r.prompts.size)
        r.d.shiftEnded(r.sim.timeMs)
        assertEquals(DetectorState.COOLDOWN, r.d.state)
        r.move(5_000.0, speedMps = 15.0, intervalS = 60)
        assertEquals(1, r.prompts.size, "no prompt on the drive home right after a shift")
    }

    @Test
    fun `disabling with the prompt up takes it down`() {
        val r = Run()
        r.motion()
        r.move(1_000.0, speedMps = 15.0)
        assertEquals(DetectorEvent.WithdrawPrompt.Reason.NO_ANSWER, (r.d.disable().single() as DetectorEvent.WithdrawPrompt).reason)
        assertEquals(DetectorState.OFF, r.d.state)
        r.motion()
        r.move(1_000.0, speedMps = 15.0)
        assertEquals(1, r.prompts.size)
    }

    // ------------------------------------------------ process death

    @Test
    fun `survives process death mid-probe and mid-prompt`() {
        val r = Run()
        r.motion()
        r.move(200.0, speedMps = 5.0)
        r.d = DriveDetector.restore(r.d.snapshot())
        assertEquals(DetectorState.PROBING, r.d.state)
        r.move(1_500.0, speedMps = 5.0)
        assertEquals(1, r.prompts.size, "the restored probe finishes the sustained window")
        val buffered = r.d.bufferedSince(0)
        val start = r.d.driveStartedAtMs
        r.d = DriveDetector.restore(r.d.snapshot())
        assertEquals(DetectorState.DETECTED, r.d.state)
        assertEquals(start, r.d.driveStartedAtMs)
        assertEquals(buffered, r.d.bufferedSince(0))
        assertNotNull(r.d.nextDeadlineMs())
        assertEquals(DetectorState.OFF, DriveDetector.restore("v=9").state)
        assertEquals(DetectorState.OFF, DriveDetector.restore(null).state)
    }

    @Test
    fun `the buffer is bounded`() {
        val r = Run(DetectorConfig(bufferMaxFixes = 50, promptHoldMs = 60 * 60_000L))
        r.motion()
        r.move(10_000.0, speedMps = 15.0)
        assertEquals(50, r.d.bufferedSince(0).size)
        assertEquals(r.d.bufferedSince(0).first().atMs, r.d.driveStartedAtMs)
    }

    @Test
    fun `off and paused ignore everything`() {
        val d = DriveDetector()
        val s = Sim()
        assertTrue(d.onFix(s.sample(speed = 30f)).isEmpty())
        assertTrue(d.onSignificantMotion(s.timeMs).isEmpty())
        assertEquals(WatchPower.NONE, d.power)
        assertNull(d.nextDeadlineMs())
        d.enable(s.timeMs)
        d.shiftStarted()
        assertTrue(d.onFix(s.sample(speed = 30f)).isEmpty())
        assertFalse(d.state == DetectorState.PROBING)
    }
}
