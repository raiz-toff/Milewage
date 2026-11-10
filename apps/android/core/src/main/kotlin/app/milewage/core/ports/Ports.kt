package app.milewage.core.ports

/**
 * Ports: what the shared code needs from the platform. The Android modules implement them
 * (:data, :tracking); the iPhone app will implement the same interfaces later.
 */

/**
 * Small secrets (the device sign-in code, the pairing key) kept encrypted at rest. The Android
 * implementation is `KeystoreSecretStore` in :data (an AES-GCM key held in the Android Keystore).
 */
interface SecretStore {
    suspend fun get(key: String): String?

    suspend fun put(key: String, value: String)

    suspend fun remove(key: String)
}

/** The current time in epoch milliseconds; a fixed clock in tests. */
fun interface Clock {
    fun nowMs(): Long
}
