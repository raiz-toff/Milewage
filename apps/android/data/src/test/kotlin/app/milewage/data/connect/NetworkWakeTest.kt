package app.milewage.data.connect

import app.milewage.data.support.TestClock
import kotlin.test.Test
import kotlin.test.assertEquals

/** When the network wakes sending: a network appearing, and the moment Android validates it. */
class NetworkWakeTest {
    private val clock = TestClock(10_000)
    private var wakes = 0
    private val wake = NetworkWake(clock, { wakes++ })

    @Test
    fun aNetworkAppearingWakesSendingAndAFlapInTheSameSecondDoesNot() {
        wake.onAvailable(1)
        wake.onAvailable(2)
        assertEquals(1, wakes)
        clock.t += NetworkWake.DEBOUNCE_MS
        wake.onAvailable(2)
        assertEquals(2, wakes)
    }

    @Test
    fun theValidatedWakeComesOnceEvenRightAfterTheAvailableOne() {
        wake.onAvailable(1) // Wi-Fi associated, DNS not ready: wake 1
        wake.onCapabilities(1, isValidated = false)
        assertEquals(1, wakes)
        wake.onCapabilities(1, isValidated = true) // traffic flows now: wake 2, not swallowed by the debounce
        wake.onCapabilities(1, isValidated = true) // signal strength changes call back too: no more wakes
        assertEquals(2, wakes)
    }

    @Test
    fun aNetworkThatLosesAndRegainsValidationWakesAgainAndALostOneIsForgotten() {
        wake.onCapabilities(1, true)
        wake.onCapabilities(1, false)
        wake.onCapabilities(1, true)
        assertEquals(2, wakes)
        wake.onLost(1)
        wake.onCapabilities(1, true) // the same handle after a reconnect
        assertEquals(3, wakes)
    }
}
