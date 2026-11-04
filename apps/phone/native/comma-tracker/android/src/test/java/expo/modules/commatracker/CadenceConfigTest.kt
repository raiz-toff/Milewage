package expo.modules.commatracker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class CadenceConfigTest {
    @Test
    fun nullAndEmptyGiveCommasDefaults() {
        val d = CadenceConfig(10_000L, 20f, 30_000L, 150_000L)
        assertEquals(d, CadenceConfig.fromMap(null))
        assertEquals(d, CadenceConfig.fromMap(emptyMap()))
    }

    @Test
    fun partialConfigOverridesOnlyGivenKeys() {
        val c = CadenceConfig.fromMap(mapOf("intervalMs" to 5_000.0, "minDisplacementM" to 10, "extra" to "x"))
        assertEquals(5_000L, c.intervalMs)
        assertEquals(10f, c.minDisplacementM)
        assertEquals(30_000L, c.maxUpdateDelayMs)
        assertEquals(150_000L, c.stillTimeoutMs)
    }

    @Test
    fun explicitNullKeepsDefault() {
        assertEquals(10_000L, CadenceConfig.fromMap(mapOf("intervalMs" to null)).intervalMs)
    }

    @Test
    fun rejectsNonNumbersAndNonFinite() {
        assertThrows(IllegalArgumentException::class.java) { CadenceConfig.fromMap(mapOf("intervalMs" to "10")) }
        assertThrows(IllegalArgumentException::class.java) { CadenceConfig.fromMap(mapOf("stillTimeoutMs" to Double.NaN)) }
    }

    @Test
    fun rejectsOutOfRangeValues() {
        assertThrows(IllegalArgumentException::class.java) { CadenceConfig.fromMap(mapOf("intervalMs" to 500)) }
        assertThrows(IllegalArgumentException::class.java) { CadenceConfig.fromMap(mapOf("minDisplacementM" to -1)) }
        assertThrows(IllegalArgumentException::class.java) { CadenceConfig.fromMap(mapOf("stillTimeoutMs" to 1_000)) }
        // maxUpdateDelay may not be below the interval
        assertThrows(IllegalArgumentException::class.java) {
            CadenceConfig.fromMap(mapOf("intervalMs" to 60_000, "maxUpdateDelayMs" to 30_000))
        }
    }

    @Test
    fun roundTripsThroughTheFlatMap() {
        val c = CadenceConfig(5_000L, 10f, 15_000L, 90_000L)
        assertEquals(c, CadenceConfig.fromMap(c.toMap()))
    }
}
