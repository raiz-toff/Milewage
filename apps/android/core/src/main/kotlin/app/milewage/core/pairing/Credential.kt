package app.milewage.core.pairing

import app.milewage.core.api.DistanceUnit
import app.milewage.core.api.Segmenter
import app.milewage.core.api.Settings
import app.milewage.core.connect.Addresses
import kotlinx.serialization.Serializable

/**
 * The pairing credential, kept whole in the [app.milewage.core.ports.SecretStore] (Keystore-backed
 * on the phone) as JSON under [Pairing.KEY_CREDENTIAL]. The same members as the Expo app's.
 */
@Serializable
data class Credential(
    /** The address the phone connected through. A phone from before plan 28 has only this. */
    val baseUrl: String,
    /** Plan 28: the server on the home network (http allowed). Only ever a home address. */
    val homeUrl: String? = null,
    /** Plan 28: the https address for away from home. Never a home address, never http. */
    val awayUrl: String? = null,
    val deviceId: Long,
    /** `mwd_` and 43 base64url characters. Opaque; the server keeps only its hash. */
    val deviceToken: String,
    /** `X-MileWage-Instance` at pairing; null when the server did not send one. */
    val instanceId: String? = null,
) {
    val addresses: Addresses get() = Addresses(baseUrl, homeUrl, awayUrl, instanceId)

    /** Never the token. */
    override fun toString(): String = "Credential(baseUrl=$baseUrl, homeUrl=$homeUrl, awayUrl=$awayUrl, deviceId=$deviceId)"
}

/** A paired phone: its credential and the last settings it read (null before the first read). */
data class PairedState(
    val credential: Credential,
    val settings: Settings?,
)

/** What the screens read to hide things (F22): all derived from the cached settings, never stored. */
data class Flags(
    /** Start the tracker and upload only when the server has the tracking module. */
    val tracking: Boolean,
    /** Show stops and the estimated split; also the `segmenter` sent at shift start. */
    val stops: Boolean,
    val segmenter: Segmenter,
    val diagnostics: Boolean,
    /** The server's sync module: without it the phone is upload-only (15 section 13). */
    val sync: Boolean,
    val distanceUnit: DistanceUnit,
    /** IANA zone of the instance; local dates never use the device zone (15 section 10). */
    val timezone: String,
) {
    companion object {
        fun of(s: Settings?): Flags {
            // Unknown (never fetched): the safest reading is the plainest one.
            val tracking = s?.modules?.tracking ?: true
            val stops = s != null && s.modules.stops == true && s.stopsEnabled && tracking
            return Flags(
                tracking = tracking,
                stops = stops,
                segmenter = if (stops) Segmenter.STOPS else Segmenter.WHOLE_SHIFT,
                diagnostics = s?.modules?.diagnostics == true,
                sync = s?.modules?.sync ?: true,
                distanceUnit = s?.distanceUnit ?: DistanceUnit.KM,
                timezone = s?.timezone ?: "UTC",
            )
        }
    }
}
