package app.milewage.data.sync

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/** What gets enqueued with WorkManager when something waits to be sent. */
class SendPlanTest {
    @Test
    fun aWaitingShiftAsksForAnyNetworkWorkAndAWifiWorkOfItsOwn() {
        val plan = SendPlan.onWaiting()
        assertEquals(listOf("milewage-send", "milewage-send-wifi"), plan.map { it.name })
        val any = plan.first { it.name == SendPlan.ONE_TIME }
        val wifi = plan.first { it.name == SendPlan.WIFI }
        assertEquals(SendWork.Network.CONNECTED, any.network)
        assertEquals(SendWork.Network.UNMETERED, wifi.network)
        assertNotEquals(any.name, wifi.name) // independent: the Wi-Fi work does not share the other's backoff
    }

    @Test
    fun theWifiWorkRetriesQuicklyAndLinearlySoANotYetReadyWifiIsTriedAgainSoon() {
        val wifi = SendPlan.onWaiting().first { it.name == SendPlan.WIFI }
        assertEquals(SendWork.Backoff.LINEAR, wifi.backoff)
        assertTrue(wifi.backoffSeconds <= 30)
        assertEquals(SendWork.Backoff.EXPONENTIAL, SendPlan.onWaiting().first { it.name == SendPlan.ONE_TIME }.backoff)
    }
}
