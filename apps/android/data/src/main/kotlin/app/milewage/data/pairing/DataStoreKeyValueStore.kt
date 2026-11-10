package app.milewage.data.pairing

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import app.milewage.core.pairing.KeyValueStore
import kotlinx.coroutines.flow.first

private val Context.pairingFile: DataStore<Preferences> by preferencesDataStore(name = "pairing")

/**
 * The plain (not secret) side of pairing on a DataStore file: the cached settings, the setup flag
 * and the stored revoke. The credential is in [app.milewage.data.secure.KeystoreSecretStore].
 */
class DataStoreKeyValueStore(private val file: DataStore<Preferences>) : KeyValueStore {
    override suspend fun get(key: String): String? = file.data.first()[stringPreferencesKey(key)]

    override suspend fun put(key: String, value: String) {
        file.edit { it[stringPreferencesKey(key)] = value }
    }

    override suspend fun remove(key: String) {
        file.edit { it.remove(stringPreferencesKey(key)) }
    }

    companion object {
        /** The app's pairing file (`pairing.preferences_pb` in the app's private storage). */
        fun pairing(context: Context) = DataStoreKeyValueStore(context.applicationContext.pairingFile)
    }
}
