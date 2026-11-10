package app.milewage.core.tracking

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
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

    @Test
    fun `the idle watch never runs GNSS when network positions or the motion sensor exist`() {
        val p = LocationPlan.watching(WatchPower.IDLE, cadence, all)
        assertEquals(listOf("network", "passive"), p.requests.map { it.provider })
        assertTrue(p.significantMotion)
        assertNull(p.recordingProvider, "nothing is stored without a shift")
        val noNetwork = LocationPlan.watching(WatchPower.IDLE, cadence, DeviceCapabilities(true, false, true))
        assertEquals(listOf("passive"), noNetwork.requests.map { it.provider })
        val bare = LocationPlan.watching(WatchPower.IDLE, cadence, deGoogled)
        assertEquals(listOf("gps", "passive"), bare.requests.map { it.provider })
        assertEquals(120_000L, bare.requests[0].intervalMs)
    }

    @Test
    fun `a probe looks closely, a detected drive records at the cadence`() {
        assertEquals(ProviderRequest("gps", 3_000, 0f, 3_000, RequestQuality.HIGH_ACCURACY), LocationPlan.watching(WatchPower.PROBE, cadence, all).requests.single())
        assertEquals(5_000L, LocationPlan.watching(WatchPower.DETECTED, cadence, all).requests.single().intervalMs)
        assertEquals(LocationPlan.NONE, LocationPlan.watching(WatchPower.NONE, cadence, all))
    }
}
