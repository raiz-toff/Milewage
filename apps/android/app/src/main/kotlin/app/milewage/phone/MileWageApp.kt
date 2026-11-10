package app.milewage.phone

import android.app.Application
import app.milewage.data.prefs.UiPreferences

/**
 * The application. Holds the few long-lived objects the screens share; the storage, pairing and
 * tracking tasks add theirs here (no dependency injection framework until one earns its place).
 */
class MileWageApp : Application() {
    val uiPreferences: UiPreferences by lazy { UiPreferences(this) }
}
