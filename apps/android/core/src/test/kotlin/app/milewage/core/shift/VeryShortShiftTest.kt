package app.milewage.core.shift

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class VeryShortShiftTest {
    @Test
    fun `119 seconds is very short, 120 is not`() {
        assertTrue(VeryShortShift.of(119_000, 0))
        assertTrue(VeryShortShift.of(119_999, 0))
        assertFalse(VeryShortShift.of(120_000, 0))
    }

    @Test
    fun `159 metres is very short, 160 is not`() {
        assertTrue(VeryShortShift.of(60_000, 159))
        assertFalse(VeryShortShift.of(60_000, 160))
    }

    @Test
    fun `both limits must hold`() {
        assertFalse(VeryShortShift.of(119_000, 160))
        assertFalse(VeryShortShift.of(120_000, 159))
        assertTrue(VeryShortShift.of(0, 0))
    }
}
