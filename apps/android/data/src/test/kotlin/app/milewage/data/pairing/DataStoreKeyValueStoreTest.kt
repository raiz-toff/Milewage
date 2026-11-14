package app.milewage.data.pairing

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import app.milewage.core.pairing.DeviceSession
import app.milewage.core.pairing.HaltReason
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeFalse
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The plain pairing store on a real DataStore file; a stored revoke survives a restart.
 * Skipped on Windows: DataStore replaces its file with File.renameTo, which Windows refuses when the
 * file exists, so the second write fails there. Phones (and CI) are Linux, where it works.
 */
class DataStoreKeyValueStoreTest {
    @Test
    fun roundTripsRemovesAndKeepsARevokeAcrossARestart() = runBlocking {
        assumeFalse("DataStore cannot replace a file on Windows", System.getProperty("os.name").orEmpty().startsWith("Windows"))
        val dir = Files.createTempDirectory("pairing").toFile()
        val file = File(dir, "pairing.preferences_pb")
        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val store = DataStoreKeyValueStore(PreferenceDataStoreFactory.create(scope = scope) { file })
        assertNull(store.get("pairing.settings"))
        store.put("pairing.settings", """{"country":"US"}""")
        assertEquals("""{"country":"US"}""", store.get("pairing.settings"))
        store.remove("pairing.settings")
        assertNull(store.get("pairing.settings"))
        DeviceSession(store).halt(HaltReason.REPAIR)
        // Wait until the first store has really closed: a second store on the same file while the
        // first is still shutting down is refused ("multiple DataStores active"), now and then on CI.
        scope.coroutineContext.job.cancelAndJoin()

        val again = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val reopened = DataStoreKeyValueStore(PreferenceDataStoreFactory.create(scope = again) { file })
        assertEquals(HaltReason.REPAIR, DeviceSession(reopened).halted())
        again.coroutineContext.job.cancelAndJoin()
        dir.deleteRecursively()
        Unit
    }
}
