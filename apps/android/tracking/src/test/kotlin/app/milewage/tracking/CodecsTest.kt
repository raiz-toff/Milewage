package app.milewage.tracking

import app.milewage.core.tracking.Interruption
import app.milewage.core.tracking.InterruptionReason
import kotlin.test.Test
import kotlin.test.assertEquals

/** The Android layer's pure helpers. Everything else the service decides is tested in :core (TrackingCoreTest). */
class CodecsTest {
    @Test
    fun interruptionsRoundTripAndBadEntriesAreSkipped() {
        val list = listOf(
            Interruption(1, 2, InterruptionReason.LOCATION_OFF),
            Interruption(10, 90_000, InterruptionReason.SERVICE_RESTARTED),
        )
        assertEquals(list, Codecs.decodeInterruptions(Codecs.encodeInterruptions(list)))
        assertEquals(emptyList(), Codecs.decodeInterruptions(null))
        assertEquals(
            listOf(Interruption(5, 6, InterruptionReason.PERMISSION_LOST)),
            Codecs.decodeInterruptions("x;1,2;5,6,PERMISSION_LOST;9,3,LOCATION_OFF;1,2,NOPE"),
        )
    }

    @Test
    fun wakeUpsAreNeverInThePastNorABusyLoop() {
        assertEquals(10_000L, Codecs.wakeDelayMs(atMs = 100, nowMs = 5_000))
        assertEquals(60_000L, Codecs.wakeDelayMs(atMs = 65_000, nowMs = 5_000))
    }

    @Test
    fun nudgeMinutesAreWholeAndNeverZero() {
        assertEquals(30L, Codecs.minutes(30 * 60_000L))
        assertEquals(31L, Codecs.minutes(30 * 60_000L + 40_000))
        assertEquals(1L, Codecs.minutes(1_000))
    }
}
