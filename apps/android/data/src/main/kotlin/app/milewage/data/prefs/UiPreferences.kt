package app.milewage.data.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.uiFile: DataStore<Preferences> by preferencesDataStore(name = "ui")

/** Settings > Theme: the phone's light or dark setting (the default), or always one of them. */
enum class AppTheme(val stored: String) {
    SYSTEM("system"),
    LIGHT("light"),
    DARK("dark"),
    ;

    companion object {
        /** An unknown or missing value follows the phone. */
        fun of(stored: String?): AppTheme = entries.firstOrNull { it.stored == stored } ?: SYSTEM
    }
}

/** Choices about how the app looks, kept on this phone only. */
class UiPreferences(context: Context) {
    private val file = context.applicationContext.uiFile

    /** Settings > Use wallpaper colours: the phone's Material You colours instead of MileWage yellow. Off by default. */
    val useWallpaperColours: Flow<Boolean> = file.data.map { it[WALLPAPER_COLOURS] ?: false }

    /** Settings > Theme. Follows the phone by default. */
    val theme: Flow<AppTheme> = file.data.map { AppTheme.of(it[THEME]) }

    suspend fun setUseWallpaperColours(on: Boolean) {
        file.edit { it[WALLPAPER_COLOURS] = on }
    }

    suspend fun setTheme(theme: AppTheme) {
        file.edit { it[THEME] = theme.stored }
    }

    private companion object {
        val WALLPAPER_COLOURS = booleanPreferencesKey("use_wallpaper_colours")
        val THEME = stringPreferencesKey("theme")
    }
}
