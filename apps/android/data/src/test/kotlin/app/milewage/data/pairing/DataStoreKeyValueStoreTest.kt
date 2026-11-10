package app.milewage.data.pairing

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import app.milewage.core.pairing.DeviceSession
import app.milewage.core.pairing.HaltReason
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The plain pairing store on a real DataStore file; a stored revoke survives a restart. */
class DataStoreKeyValueStoreTest {
    @Test
    fun roundTripsRemovesAndKeepsARevokeAcrossARestart() = runBlocking {
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
        scope.cancel()

        val again = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val reopened = DataStoreKeyValueStore(PreferenceDataStoreFactory.create(scope = again) { file })
        assertEquals(HaltReason.REPAIR, DeviceSession(reopened).halted())
        again.cancel()
        dir.deleteRecursively()
        Unit
    }
}
