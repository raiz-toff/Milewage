// Port of packages/track-engine/src/live.ts.
package app.milewage.engine

interface LiveAccumulator {
    fun push(fix: Fix)

    /** Approximate running total in whole metres; shown to the driver, never stored. */
    fun runningTotalM(): Long
}

/**
 * Runs stages 1-3 one fix at a time with the same stage functions as the batch path.
 * Fixes are expected in time order; the shift end is unknown, so only the lower
 * window bound applies. It reads no clock: all time comes from the fixes.
 * Not thread-safe: push from one thread (the tracking service's).
 */
fun createLiveAccumulator(startedAt: Long): LiveAccumulator =
    object : LiveAccumulator {
        private val seen = HashSet<Long>()
        private var anchor: Fix? = null
        private var totalDm = 0L

        override fun push(fix: Fix) {
            if (fix.recordedAt < startedAt - WINDOW_BEFORE_MS) return // stage 1
            if (!seen.add(fix.seq)) return
            if (!isQualified(fix)) return // stage 2
            val step = gateStep(anchor, fix) // stage 3
            if (step is GateStep.Drop) return
            if (step is GateStep.Accept) totalDm += step.distanceDm
            anchor = fix
        }

        override fun runningTotalM(): Long = dmToM(totalDm)
    }
