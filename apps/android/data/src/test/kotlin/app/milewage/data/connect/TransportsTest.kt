package app.milewage.data.connect

import android.net.NetworkCapabilities.TRANSPORT_CELLULAR
import android.net.NetworkCapabilities.TRANSPORT_ETHERNET
import android.net.NetworkCapabilities.TRANSPORT_VPN
import android.net.NetworkCapabilities.TRANSPORT_WIFI
import app.milewage.core.connect.NetState
import app.milewage.core.connect.NetTransport
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The Expo app's net-check tests: LocalNetworkTest and VpnStateTest. */
class TransportsTest {
    @Test
    fun wifiAndEthernetAreLocalTailscaleOverWifiStillIsMobileDataIsNot() {
        assertEquals(true, NetState.localNetwork(Transports.of { it == TRANSPORT_WIFI }))
        assertEquals(true, NetState.localNetwork(Transports.of { it == TRANSPORT_ETHERNET }))
        assertEquals(true, NetState.localNetwork(Transports.of { it in setOf(TRANSPORT_WIFI, TRANSPORT_VPN) }))
        assertEquals(false, NetState.localNetwork(Transports.of { it in setOf(TRANSPORT_CELLULAR, TRANSPORT_VPN) }))
        assertNull(NetState.localNetwork(Transports.of(null)))
    }

    @Test
    fun aVpnOverWifiIsAVpnWifiAloneIsNot() {
        assertEquals(true, NetState.vpnActive(Transports.of { it in setOf(TRANSPORT_WIFI, TRANSPORT_VPN) }))
        assertEquals(false, NetState.vpnActive(Transports.of { it == TRANSPORT_WIFI }))
        assertNull(NetState.vpnActive(Transports.of(null)))
        assertEquals(setOf(NetTransport.OTHER), Transports.of { false })
    }
}
