package app.milewage.phone.ui.nav

import kotlinx.serialization.Serializable

/**
 * Type-safe Navigation Compose routes. The names follow the Expo app's screens
 * (apps/phone/src/navigation.tsx) so the port can be checked screen by screen.
 */

/** First run: shown while this phone is not paired with a server. */
@Serializable
object FirstRunGraph

@Serializable
object WelcomeRoute

/** The app proper: shown once the phone is paired. */
@Serializable
object MainGraph

@Serializable
object HomeRoute

@Serializable
object ShiftsRoute

@Serializable
object SettingsRoute

@Serializable
data class ShiftDetailRoute(val clientId: String)
