package expo.modules.netcheck

import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServiceEntryTest {
  private val v6 = InetAddress.getByName("fe80::1")
  private val v4 = InetAddress.getByName("192.168.1.20")

  @Test
  fun prefersIpv4AndReadsTheRecordAsText() {
    val e = ServiceEntry.of("MileWage (box)", listOf(v6, v4), 8080, mapOf("v" to "1".toByteArray(), "id" to "inst-1".toByteArray(), "x" to null))
    assertEquals(
      mapOf("name" to "MileWage (box)", "host" to "192.168.1.20", "port" to 8080, "txt" to mapOf("v" to "1", "id" to "inst-1", "x" to "")),
      e,
    )
  }

  @Test
  fun ipv6WithoutItsZone() {
    val scoped = InetAddress.getByName("fe80::1%1")
    assertEquals("fe80:0:0:0:0:0:0:1", ServiceEntry.of("m", listOf(scoped), 80, emptyMap())!!["host"])
  }

  @Test
  fun noAddressOrNoPortIsNothing() {
    assertNull(ServiceEntry.of("m", emptyList(), 8080, emptyMap()))
    assertNull(ServiceEntry.of("m", listOf(v4), 0, emptyMap()))
  }
}
