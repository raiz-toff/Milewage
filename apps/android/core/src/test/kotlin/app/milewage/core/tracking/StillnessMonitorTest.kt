package app.milewage.core.tracking

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StillnessMonitorTest {
    private class Run(config: StillnessConfig = StillnessConfig()) {
        val sim = Sim()
        val m = StillnessMonitor(config, sim.timeMs)
        val events = ArrayList<StillnessEvent>()

        fun fix(s: Sample = sim.sample()) {
            events += m.onFix(s)
        }

        /** Fixes every [intervalS] seconds for [seconds], standing still with jitter. */
        fun park(seconds: Int, intervalS: Int = 5, jitterM: Double = 6.0, accuracy: Float = 10f) {
            var t = 0
            while (t < seconds) {
                sim.timeMs += intervalS * 1000L
                t += intervalS
                fix(sim.sample(accuracy = accuracy, speed = sim.randomSpeed(0.6), jitterM = jitterM))
                events += m.onTick(sim.timeMs)
            }
        }

        fun ride(metres: Double, speedMps: Double = 8.0, intervalS: Int = 5) {
            var done = 0.0
            while (done < metres) {
                val step = minOf(speedMps * intervalS, metres - done)
                sim.northM += step
                done += step
                sim.timeMs += intervalS * 1000L
                fix(sim.sample(speed = speedMps.toFloat()))
            }
        }

        fun tickFor(seconds: Int, everyS: Int = 15) {
            var t = 0
            while (t < seconds) {
                sim.timeMs += everyS * 1000L
                t += everyS
                events += m.onTick(sim.timeMs)
            }
        }

        val lowPower get() = events.filterIsInstance<StillnessEvent.EnterLowPower>()
        val wakeUps get() = events.filterIsInstance<StillnessEvent.WakeUp>()
        val nudges get() = events.filterIsInstance<StillnessEvent.PostNudge>()
    }

    @Test
    fun `a ride keeps full power, a stop drops to low power after the still timeout and not before`() {
        val r = Run()
        r.ride(3_000.0)
        assertEquals(PowerLevel.FULL, r.m.power)
        val arrived = r.sim.timeMs
        // The engine's stop detection needs dense fixes for the first 120 s of a dwell (STOP_MIN_DWELL_MS).
        r.park(145)
        assertEquals(PowerLevel.FULL, r.m.power, "still 145 s: fixes keep coming at the cadence")
        r.park(10)
        assertEquals(PowerLevel.LOW, r.m.power)
        assertEquals(listOf(StillnessEvent.EnterLowPower(StillnessEvent.EnterLowPower.Reason.STILL)), r.lowPower)
        assertTrue(r.sim.timeMs - arrived >= 150_000)
    }

    @Test
    fun `a sparse fix that moved wakes it, and so does a fast one inside the radius`() {
        val r = Run()
        r.park(200)
        assertEquals(PowerLevel.LOW, r.m.power)
        r.sim.timeMs += 60_000
        r.sim.northM += 80.0
        r.fix(r.sim.sample(accuracy = 10f))
        assertEquals(PowerLevel.FULL, r.m.power)
        assertEquals(StillnessEvent.WakeUp.Reason.MOVED, r.wakeUps.single().reason)

        val q = Run()
        q.park(200)
        q.sim.timeMs += 60_000
        q.fix(q.sim.sample(accuracy = 8f, speed = 4f)) // pulling away, still within 40 m
        assertEquals(StillnessEvent.WakeUp.Reason.SPEED, q.wakeUps.single().reason)
    }

    @Test
    fun `the significant-motion sensor wakes it, and it stays at full power for the still timeout`() {
        val r = Run()
        r.park(200)
        assertEquals(PowerLevel.LOW, r.m.power)
        r.events += r.m.onSignificantMotion(r.sim.timeMs)
        assertEquals(StillnessEvent.WakeUp.Reason.SIGNIFICANT_MOTION, r.wakeUps.single().reason)
        // A walk around the car: fixes inside the radius. Not back to low power at once.
        r.park(140)
        assertEquals(PowerLevel.FULL, r.m.power)
        r.park(15)
        assertEquals(PowerLevel.LOW, r.m.power)
        assertEquals(2, r.lowPower.size)
    }

    @Test
    fun `a coarse network fix moves it only when clearly outside both radii`() {
        val r = Run()
        r.park(200)
        r.sim.timeMs += 60_000
        r.sim.northM += 300.0
        r.fix(r.sim.sample(accuracy = 500f, provider = RawLocation.NETWORK))
        assertEquals(PowerLevel.LOW, r.m.power, "300 m with a 500 m radius says nothing")
        r.sim.northM = 2_000.0
        r.sim.timeMs += 60_000
        r.fix(r.sim.sample(accuracy = 500f, provider = RawLocation.NETWORK))
        assertEquals(PowerLevel.FULL, r.m.power)
    }

    @Test
    fun `poor accuracy wander of 20 to 45 m while parked is not movement`() {
        val r = Run()
        r.park(30)
        for (i in 1..60) {
            r.sim.timeMs += 5_000
            val w = 20 + (i * 11) % 26
            r.sim.northM = if (i % 2 == 0) w.toDouble() else -w.toDouble()
            r.fix(r.sim.sample(accuracy = minOf(50f, w + 1f)))
        }
        assertEquals(PowerLevel.LOW, r.m.power)
        assertTrue(r.wakeUps.isEmpty())
    }

    @Test
    fun `a tunnel while riding does not count as still, no signal for 5 minutes drops to low power`() {
        val r = Run()
        r.ride(2_000.0)
        r.tickFor(240)
        assertEquals(PowerLevel.FULL, r.m.power, "4 minutes in a tunnel: keep looking")
        r.tickFor(75)
        assertEquals(StillnessEvent.EnterLowPower.Reason.NO_SIGNAL, r.lowPower.single().reason)
        // Out of the tunnel, a fix far away wakes it.
        r.sim.northM += 3_000.0
        r.fix(r.sim.sample(accuracy = 6f, speed = 10f))
        assertEquals(PowerLevel.FULL, r.m.power)
    }

    @Test
    fun `nudge once after 30 minutes still, movement takes it down, keep going silences this stop`() {
        val r = Run()
        r.park(29 * 60, intervalS = 60)
        assertTrue(r.nudges.isEmpty())
        r.park(90, intervalS = 60)
        assertEquals(1, r.nudges.size)
        r.park(30 * 60, intervalS = 60)
        assertEquals(1, r.nudges.size, "once per still period")
        r.sim.northM += 500.0
        r.fix(r.sim.sample())
        assertTrue(r.events.contains(StillnessEvent.CancelNudge))
        assertEquals(PowerLevel.FULL, r.m.power)

        r.park(31 * 60, intervalS = 60)
        assertEquals(2, r.nudges.size, "a new still period nudges again")
        assertEquals(listOf(StillnessEvent.CancelNudge), r.m.keepGoing())
        r.park(60 * 60, intervalS = 60)
        assertEquals(2, r.nudges.size, "keep going: not again until it moves")
    }

    @Test
    fun `the nudge can be turned off`() {
        val r = Run(StillnessConfig(nudgeAfterMs = 0))
        r.park(3 * 60 * 60, intervalS = 120)
        assertTrue(r.nudges.isEmpty())
    }

    @Test
    fun `the nudge also comes indoors with no fix at all once the phone has been placed`() {
        val r = Run()
        r.park(60)
        r.tickFor(31 * 60, everyS = 60)
        assertEquals(1, r.nudges.size)
    }

    @Test
    fun `survives process death with its state`() {
        val r = Run()
        r.ride(1_000.0)
        r.park(200)
        val stillSince = r.m.stillSinceMs
        val restored = StillnessMonitor.restore(r.m.snapshot(), StillnessConfig(), 0)
        assertEquals(PowerLevel.LOW, restored.power)
        assertEquals(stillSince, restored.stillSinceMs)
        // Same anchor: a fix 80 m away wakes the restored one.
        r.sim.timeMs += 60_000
        r.sim.northM += 80.0
        val events = restored.onFix(r.sim.sample())
        assertEquals(PowerLevel.FULL, restored.power)
        assertEquals(StillnessEvent.WakeUp.Reason.MOVED, events.filterIsInstance<StillnessEvent.WakeUp>().single().reason)
        assertEquals(PowerLevel.FULL, StillnessMonitor.restore("garbage", StillnessConfig(), 0).power)
    }

    @Test
    fun `next deadline is the no-signal limit, then the nudge`() {
        val r = Run()
        val first = r.sim.sample()
        r.fix(first)
        assertEquals(first.atMs + 300_000, r.m.nextDeadlineMs(), "going still is judged on a fix, no wake-up needed")
        r.park(200)
        assertEquals(first.atMs + StillnessConfig().nudgeAfterMs, r.m.nextDeadlineMs())
        r.events += r.m.onTick(first.atMs + StillnessConfig().nudgeAfterMs)
        assertNull(r.m.nextDeadlineMs())
    }
}
