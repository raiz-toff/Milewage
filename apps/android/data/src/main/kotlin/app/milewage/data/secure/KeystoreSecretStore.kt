package app.milewage.data.secure

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import app.milewage.core.ports.SecretStore
import kotlinx.coroutines.flow.first
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

private val Context.secretsFile: DataStore<Preferences> by preferencesDataStore(name = "secrets")

/**
 * [SecretStore] on the Android Keystore: each value is sealed with AES-256-GCM ([SecretCipher])
 * under a non-exportable key held by the Keystore (hardware-backed where the phone has it), and the
 * sealed text is kept in a DataStore file in the app's private storage.
 *
 * Chosen over `androidx.security:security-crypto` (EncryptedSharedPreferences), which Google
 * deprecated in 2025, and over Tink, which would add a dependency for what the platform Keystore
 * already does. The app is excluded from backups (`allowBackup="false"`), so a sealed value never
 * reaches a phone whose Keystore cannot open it; if the key is lost anyway (a factory reset of the
 * Keystore), [get] returns null and the driver pairs again.
 */
class KeystoreSecretStore(context: Context) : SecretStore {
    private val file = context.applicationContext.secretsFile
    private val cipher = SecretCipher(::keystoreKey)

    override suspend fun get(key: String): String? {
        val sealed = file.data.first()[stringPreferencesKey(key)] ?: return null
        return cipher.open(key, sealed)
    }

    override suspend fun put(key: String, value: String) {
        val sealed = cipher.seal(key, value)
        file.edit { it[stringPreferencesKey(key)] = sealed }
    }

    override suspend fun remove(key: String) {
        file.edit { it.remove(stringPreferencesKey(key)) }
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "milewage.secrets.v1"

        @Synchronized
        fun keystoreKey(): SecretKey {
            val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
            (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
            val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build()
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
                init(spec)
                generateKey()
            }
        }
    }
}
