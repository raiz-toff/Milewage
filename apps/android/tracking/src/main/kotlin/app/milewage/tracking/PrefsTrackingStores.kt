package app.milewage.tracking

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import app.milewage.core.tracking.ActiveShift
import app.milewage.core.tracking.ActiveShiftStore
import app.milewage.core.tracking.Interruption
import app.milewage.core.tracking.InterruptionLog
import app.milewage.core.tracking.TrackingSettings
import app.milewage.core.tracking.TrackingSettingsStore
import app.milewage.core.tracking.TrackingStateStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The small tracking stores on SharedPreferences (`milewage_tracking.xml`; the app excludes all
 * its data from backups). Written with `commit()` so a value is on disk before the service that
 * reads it starts (the Expo tracker's rule: write the flag before starting the service).
 */
class PrefsTrackingStores(context: Context) {
    private val prefs: SharedPreferences = open(context)

    val activeShift: ActiveShiftStore = object : ActiveShiftStore {
        override suspend fun get(): ActiveShift? = withContext(Dispatchers.IO) { readActiveShift(prefs) }

        override suspend fun set(shift: ActiveShift?) = io {
            prefs.edit(commit = true) {
                if (shift == null) {
                    remove(K_SHIFT_ID)
                    remove(K_SHIFT_STARTED)
                } else {
                    putString(K_SHIFT_ID, shift.shiftClientId)
                    putLong(K_SHIFT_STARTED, shift.startedAt)
                }
            }
        }
    }

    val settings: TrackingSettingsStore = object : TrackingSettingsStore {
        override suspend fun get(): TrackingSettings = withContext(Dispatchers.IO) { readSettings(prefs) }

        override suspend fun set(settings: TrackingSettings) = io {
            prefs.edit(commit = true) {
                for ((key, value) in settings.toMap()) {
                    val k = K_SETTING + key
                    when (value) {
                        is Boolean -> putBoolean(k, value)
                        is Float -> putFloat(k, value)
                        is Number -> putLong(k, value.toLong())
                    }
                }
            }
        }
    }

    val interruptions: InterruptionLog = object : InterruptionLog {
        override suspend fun record(shiftClientId: String, interruption: Interruption) = io {
            val key = K_INTERRUPTIONS + shiftClientId
            val list = Codecs.decodeInterruptions(prefs.getString(key, null)) + interruption
            prefs.edit(commit = true) { putString(key, Codecs.encodeInterruptions(list)) }
        }

        override suspend fun list(shiftClientId: String): List<Interruption> = withContext(Dispatchers.IO) {
            Codecs.decodeInterruptions(prefs.getString(K_INTERRUPTIONS + shiftClientId, null))
        }

        override suspend fun clear(shiftClientId: String) = io {
            prefs.edit(commit = true) { remove(K_INTERRUPTIONS + shiftClientId) }
        }
    }

    val state: TrackingStateStore = object : TrackingStateStore {
        override suspend fun load(key: String): String? = withContext(Dispatchers.IO) { prefs.getString(K_STATE + key, null) }

        override suspend fun save(key: String, value: String?) = io {
            prefs.edit(commit = true) { if (value == null) remove(K_STATE + key) else putString(K_STATE + key, value) }
        }
    }

    private suspend fun io(block: () -> Unit) = withContext(Dispatchers.IO) { block() }

    companion object {
        const val FILE = "milewage_tracking"
        private const val K_SHIFT_ID = "shift.id"
        private const val K_SHIFT_STARTED = "shift.startedAt"
        private const val K_SETTING = "setting."
        private const val K_INTERRUPTIONS = "interruptions."
        private const val K_STATE = "state."

        /** Synchronous read for a receiver (cheap: one small XML file, cached by Android). */
        fun readActiveShift(prefs: SharedPreferences): ActiveShift? {
            val id = prefs.getString(K_SHIFT_ID, null)?.takeIf { it.isNotBlank() } ?: return null
            return ActiveShift(id, prefs.getLong(K_SHIFT_STARTED, 0L))
        }

        fun readSettings(prefs: SharedPreferences): TrackingSettings =
            TrackingSettings.fromMap(
                prefs.all.filterKeys { it.startsWith(K_SETTING) }.mapKeys { it.key.removePrefix(K_SETTING) },
            )

        fun open(context: Context): SharedPreferences =
            context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    }
}
