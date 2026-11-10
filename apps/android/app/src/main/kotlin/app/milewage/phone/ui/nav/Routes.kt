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

/** "I don't have one yet": the steps to do on a computer. */
@Serializable
object ServerSetupRoute

/** The ways to connect: this Wi-Fi, the QR code, a link, the code or address typed. */
@Serializable
object ConnectRoute

/** The camera, reading the pairing QR. */
@Serializable
object ScanRoute

/** Linking with a 6-digit code at a server found on the Wi-Fi (or typed). [name]: what to call it. */
@Serializable
data class LinkRoute(val url: String, val name: String)

@Serializable
object TailscaleRoute

/** After a first connection: what the server sent, the permissions, Ready. */
@Serializable
object SetupGraph

@Serializable
object ConnectedRoute

@Serializable
object SetupPermissionsRoute

@Serializable
object ReadyRoute

/** The app proper: shown once the phone is paired (or while a shift runs). */
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

/** The permissions ladder: from Home's checklist, every "Fix permissions" and Settings. */
@Serializable
object PermissionsRoute

/** Settings > Open-source licences. */
@Serializable
object LicencesRoute

/** The mileage maths check and the phone's states (long press on Home's title; a button in debug builds). */
@Serializable
object DiagnosticsRoute
