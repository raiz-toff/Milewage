package app.milewage.core.pairing

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The Expo app's ScanGateTest (native/qr-scanner). The ZXing round trip is QrDecoderTest in :data. */
class ScanGateTest {
    @Test
    fun passesACodeOnceThenAgainAfterThePause() {
        val g = ScanGate(repeatMs = 2_000)
        assertTrue(g.accept("milewage://pair?v=1", 0))
        assertFalse(g.accept("milewage://pair?v=1", 500))
        assertFalse(g.accept(" milewage://pair?v=1 ", 1_999))
        assertTrue(g.accept("milewage://pair?v=1", 2_000))
        assertTrue(g.accept("https://other", 2_100)) // a different code at once
    }

    @Test
    fun neverPassesBlankText() {
        val g = ScanGate()
        assertFalse(g.accept(null, 0))
        assertFalse(g.accept("  ", 0))
    }
}
