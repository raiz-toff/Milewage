package app.milewage.core.pairing

import app.milewage.core.ports.SecretStore
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Plain (not secret) key-value storage on the phone: the cached settings, the setup flag, the
 * stored revoke. The device token goes to the [SecretStore] instead. `DataStoreKeyValueStore` in
 * :data implements it on a DataStore file.
 */
interface KeyValueStore {
    suspend fun get(key: String): String?

    suspend fun put(key: String, value: String)

    suspend fun remove(key: String)
}

/** Both stores in memory: tests, previews. */
class MemoryStore : KeyValueStore, SecretStore {
    private val lock = Mutex()
    private val map = LinkedHashMap<String, String>()

    /** A copy of what is stored. */
    suspend fun snapshot(): Map<String, String> = lock.withLock { LinkedHashMap(map) }

    override suspend fun get(key: String): String? = lock.withLock { map[key] }

    override suspend fun put(key: String, value: String) {
        lock.withLock { map[key] = value }
    }

    override suspend fun remove(key: String) {
        lock.withLock { map.remove(key) }
    }
}
