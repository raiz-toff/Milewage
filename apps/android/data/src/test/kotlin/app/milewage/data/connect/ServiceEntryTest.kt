package app.milewage.data.connect

import android.net.NetworkCapabilities.TRANSPORT_CELLULAR
import android.net.NetworkCapabilities.TRANSPORT_ETHERNET
import android.net.NetworkCapabilities.TRANSPORT_VPN
import android.net.NetworkCapabilities.TRANSPORT_WIFI
import app.milewage.core.connect.Announcement
import app.milewage.core.connect.Discovery
import app.milewage.core.connect.FoundServer
import app.milewage.core.connect.NetState
import app.milewage.core.connect.NetTransport
import java.net.InetAddress
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The Expo app's net-check tests: ServiceEntryTest, LocalNetworkTest and VpnStateTest. */
class ServiceEntryTest {
    private val v6 = InetAddress.getByName("fe80::1")
    private val v4 = InetAddress.getByName("192.168.1.20")

    @Test
    fun prefersIpv4AndReadsTheRecordAsText() {
        val e = ServiceEntry.of(
            "MileWage (box)", listOf(v6, v4), 8080,
            mapOf("v" to "1".toByteArray(), "id" to "inst-1".toByteArray(), "x" to null),
        )
        assertEquals(Announcement("MileWage (box)", "192.168.1.20", 8080, mapOf("v" to "1", "id" to "inst-1", "x" to "")), e)
        assertEquals(listOf(FoundServer("MileWage (box)", "http://192.168.1.20:8080", "inst-1")), Discovery.serversFrom(listOf(e!!)))
    }

    @Test
    fun ipv6WithoutItsZone() {
        val scoped = InetAddress.getByName("fe80::1%1")
        assertEquals("fe80:0:0:0:0:0:0:1", ServiceEntry.of("m", listOf(scoped), 80, emptyMap())!!.host)
    }

    @Test
    fun noAddressOrNoPortIsNothing() {
        assertNull(ServiceEntry.of("m", emptyList(), 8080, emptyMap()))
        assertNull(ServiceEntry.of("m", listOf(v4), 0, emptyMap()))
    }

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
