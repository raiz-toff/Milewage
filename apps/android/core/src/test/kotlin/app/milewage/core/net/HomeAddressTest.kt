package app.milewage.core.net

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The cases of packages/shared/test/home-address.test.ts, unchanged. */
class HomeAddressTest {
    @Test
    fun homeHosts() {
        val home = listOf(
            "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.1.20", "169.254.10.20",
            "fd12:3456:789a::1", "fc00::1", "fe80::1", "fe80::1%wlan0", "[fd00::5]", "::ffff:192.168.1.20",
            "milewage.local", "MileWage-Box.Local", "milewage.local.", "box.lan", "server.home.arpa",
        )
        for (h in home) assertEquals(h to true, h to HomeAddress.isHomeHost(h))
    }

    @Test
    fun notHome() {
        val away = listOf(
            "localhost", "127.0.0.1", "::1", "0.0.0.0", "8.8.8.8", "172.15.255.255", "172.32.0.1",
            "192.169.0.1", "11.0.0.1", "100.100.1.2", "box.tail1234.ts.net", "example.com", "local",
            "evil.local.example.com", "lan", "fec0::1", "2001:db8::1", "256.1.1.1", "10.0.0",
            "bad host.local", "",
        )
        for (h in away) assertEquals(h to false, h to HomeAddress.isHomeHost(h))
    }

    @Test
    fun httpOnlyToAHomeAddressHttpsEverywhere() {
        assertTrue(HomeAddress.httpAllowed("http://192.168.1.20:8080"))
        assertTrue(HomeAddress.httpAllowed("http://[fd00::5]:8080/"))
        assertTrue(HomeAddress.httpAllowed("http://milewage.local"))
        assertTrue(HomeAddress.httpAllowed("https://box.tail1234.ts.net"))
        assertTrue(HomeAddress.httpAllowed("https://192.168.1.20"))
        assertFalse(HomeAddress.httpAllowed("http://box.tail1234.ts.net"))
        assertFalse(HomeAddress.httpAllowed("http://8.8.8.8"))
        assertFalse(HomeAddress.httpAllowed("http://localhost:5173"))
        // user information cannot hide the real host
        assertFalse(HomeAddress.httpAllowed("http://192.168.1.20@example.com/"))
        assertFalse(HomeAddress.httpAllowed("ftp://192.168.1.20"))
        assertFalse(HomeAddress.httpAllowed("not an address"))
        assertTrue(HomeAddress.isHomeAddress("HTTP://192.168.1.20"))
        assertFalse(HomeAddress.isHomeAddress("https://example.com"))
        assertEquals(
            HomeAddress.Parts(HomeAddress.Scheme.HTTPS, "fd00::5"),
            HomeAddress.parts("https://[FD00::5]:443/x"),
        )
        assertNull(HomeAddress.parts("mailto:someone"))
    }
}
