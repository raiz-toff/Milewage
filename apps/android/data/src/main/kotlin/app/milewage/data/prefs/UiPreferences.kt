package app.milewage.data.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.uiFile: DataStore<Preferences> by preferencesDataStore(name = "ui")

/** Choices about how the app looks, kept on this phone only. */
class UiPreferences(context: Context) {
    private val file = context.applicationContext.uiFile

    /** Settings > Use wallpaper colours: the phone's Material You colours instead of MileWage yellow. Off by default. */
    val useWallpaperColours: Flow<Boolean> = file.data.map { it[WALLPAPER_COLOURS] ?: false }

    suspend fun setUseWallpaperColours(on: Boolean) {
        file.edit { it[WALLPAPER_COLOURS] = on }
    }

    private companion object {
        val WALLPAPER_COLOURS = booleanPreferencesKey("use_wallpaper_colours")
    }
}
