package app.milewage.core.pairing

import app.milewage.core.api.ApiException
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Expo app's deviceSession.test.ts ("the one holder of a halt"). */
class DeviceSessionTest {
    @Test
    fun reads401And403OnceARevokeMeansRepairAnythingElseASignInProblem() {
        fun e(status: Int, code: String) = ApiException(status, code, false)
        assertEquals(HaltReason.REPAIR, DeviceSession.haltFor(e(401, "device_revoked")))
        assertEquals(HaltReason.AUTH_PROBLEM, DeviceSession.haltFor(e(401, "invalid_token")))
        assertEquals(HaltReason.AUTH_PROBLEM, DeviceSession.haltFor(e(403, "scope_forbidden")))
        assertNull(DeviceSession.haltFor(e(404, "shift_not_found")))
        assertNull(DeviceSession.haltFor(e(0, "network")))
    }

    @Test
    fun haltsSaysWhyMostSeriousFirstAndResumeLiftsEveryHalt() = runTest {
        val plain = MemoryStore()
        val d = DeviceSession(plain)
        assertNull(d.halted())
        d.halt(HaltReason.AUTH_PROBLEM)
        assertEquals(HaltReason.AUTH_PROBLEM, d.halted())
        d.halt(HaltReason.WRONG_SERVER)
        assertEquals(HaltReason.WRONG_SERVER, d.halted())
        assertTrue(d.blocked())
        d.halt(HaltReason.REPAIR)
        assertEquals(HaltReason.REPAIR, d.halted())
        d.resume()
        assertNull(d.halted())
        assertFalse(d.blocked())
        assertTrue(plain.snapshot().isEmpty())
    }

    @Test
    fun onlyAnotherServerAtTheAddressBlocksEveryRequestOutright() = runTest {
        val d = DeviceSession(MemoryStore())
        d.halt(HaltReason.REPAIR)
        d.halt(HaltReason.AUTH_PROBLEM)
        assertFalse(d.blocked())
    }

    @Test
    fun aRevokeIsKeptAcrossARestartTheOtherHaltsAreNot() = runTest {
        val plain = MemoryStore()
        val first = DeviceSession(plain)
        first.halt(HaltReason.REPAIR)
        first.halt(HaltReason.WRONG_SERVER)
        assertEquals(HaltReason.REPAIR, DeviceSession(plain).halted())
        val other = MemoryStore()
        DeviceSession(other).halt(HaltReason.AUTH_PROBLEM)
        assertNull(DeviceSession(other).halted())
    }

    @Test
    fun tellsItsListenersAboutEachHaltRepeatedOnesTooAndEachResume() = runTest {
        val d = DeviceSession(MemoryStore())
        var heard = 0
        val off = d.subscribe { heard++ }
        d.halt(HaltReason.REPAIR)
        d.halt(HaltReason.REPAIR)
        d.resume()
        assertEquals(3, heard)
        off()
        d.halt(HaltReason.AUTH_PROBLEM)
        assertEquals(3, heard)
    }
}
