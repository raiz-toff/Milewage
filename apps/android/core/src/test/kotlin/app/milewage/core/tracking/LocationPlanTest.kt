package app.milewage.core.tracking

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LocationPlanTest {
    private val all = DeviceCapabilities(hasGps = true, hasNetwork = true, hasSignificantMotion = true)
    private val deGoogled = DeviceCapabilities(hasGps = true, hasNetwork = false, hasSignificantMotion = false)
    private val cadence = CadenceConfig()

    @Test
    fun `a moving shift asks the GNSS receiver for every fix at the cadence, with no distance filter`() {
        val p = LocationPlan.recording(PowerLevel.FULL, cadence, all)
        assertEquals(listOf(ProviderRequest("gps", 5_000, 0f, 15_000, RequestQuality.HIGH_ACCURACY)), p.requests)
        assertEquals("gps", p.recordingProvider)
        assertFalse(p.significantMotion)
    }

    @Test
    fun `a still shift watches cheaply and arms the motion sensor`() {
        val p = LocationPlan.recording(PowerLevel.LOW, cadence, all)
        assertEquals(listOf("gps", "network", "passive"), p.requests.map { it.provider })
        assertEquals(60_000L, p.requests[0].intervalMs)
        assertTrue(p.significantMotion)
        assertEquals("gps", p.recordingProvider)
        // A phone without network positions or the sensor still wakes on the sparse GNSS checks.
        val d = LocationPlan.recording(PowerLevel.LOW, cadence, deGoogled)
        assertEquals(listOf("gps", "passive"), d.requests.map { it.provider })
        assertFalse(d.significantMotion)
    }

    @Test
    fun `a phone without GNSS records from the network provider, and one with nothing records nothing`() {
        val p = LocationPlan.recording(PowerLevel.FULL, cadence, DeviceCapabilities(false, true, false))
        assertEquals("network", p.recordingProvider)
        assertEquals("network", p.requests.single().provider)
        assertEquals(LocationPlan.NONE, LocationPlan.recording(PowerLevel.FULL, cadence, DeviceCapabilities(false, false, true)))
    }
}
