package app.milewage.core.tracking

/** What the phone has, read once by the service. */
data class DeviceCapabilities(
    /** `LocationManager.GPS_PROVIDER` exists. */
    val hasGps: Boolean,
    /** `LocationManager.NETWORK_PROVIDER` exists (often missing on de-Googled phones). */
    val hasNetwork: Boolean,
    /** `Sensor.TYPE_SIGNIFICANT_MOTION` exists (no permission needed). */
    val hasSignificantMotion: Boolean,
)

/** `LocationRequestCompat` quality. */
enum class RequestQuality { HIGH_ACCURACY, BALANCED_POWER_ACCURACY, LOW_POWER }

/** One `LocationManager` request. */
data class ProviderRequest(
    val provider: String,
    val intervalMs: Long,
    val minDistanceM: Float,
    val maxUpdateDelayMs: Long,
    val quality: RequestQuality,
)

/**
 * The location requests for one state, and which fixes are stored. The service only applies it;
 * the choices are here so they are tested.
 *
 * Provider strategy (platform `LocationManager` only, no Google Play Services):
 *
 * - Recording uses the `gps` provider (the GNSS receiver): raw satellite fixes with GNSS time,
 *   so the engine and the server work from the same kind of fix the Expo app stored and the clock
 *   skew can be measured. Not `fused` (API 31+): on a phone with Google services it is Google's
 *   fused provider, elsewhere AOSP's; it may hand out Wi-Fi and cell positions in place of GNSS
 *   ones, smooths, and is missing below Android 12. A phone without a GNSS receiver records from
 *   `network` instead.
 * - Only fixes from the recording provider are stored ([recordingProvider]). Network positions
 *   (Wi-Fi, cell) feed the stillness decisions but are not stored: indoors a Wi-Fi
 *   position can sit 40 m off with a 30 m radius, which the engine would count as a move.
 * - `passive` delivers fixes other apps asked for at no cost; GNSS ones among them are stored too.
 */
data class LocationPlan(
    val requests: List<ProviderRequest>,
    /** Arm the significant-motion sensor (where the phone has one). */
    val significantMotion: Boolean,
    /** Fixes from this provider are stored while a shift records; null stores nothing. */
    val recordingProvider: String?,
) {
    companion object {
        val NONE = LocationPlan(emptyList(), significantMotion = false, recordingProvider = null)

        /** Passive fixes at most this often. */
        const val PASSIVE_INTERVAL_MS = 5_000L

        /** During a shift. */
        fun recording(level: PowerLevel, cadence: CadenceConfig, caps: DeviceCapabilities): LocationPlan {
            val provider = when {
                caps.hasGps -> RawLocation.GPS
                caps.hasNetwork -> RawLocation.NETWORK
                else -> return NONE
            }
            return when (level) {
                PowerLevel.FULL -> LocationPlan(
                    listOf(
                        ProviderRequest(
                            provider, cadence.intervalMs, cadence.minDisplacementM, cadence.maxUpdateDelayMs,
                            RequestQuality.HIGH_ACCURACY,
                        ),
                    ),
                    significantMotion = false,
                    recordingProvider = provider,
                )
                PowerLevel.LOW -> LocationPlan(
                    buildList {
                        // GNSS at the sparse interval: AOSP duty-cycles the receiver at 10 s and over.
                        add(
                            ProviderRequest(
                                provider, cadence.lowPowerIntervalMs, 0f, cadence.lowPowerIntervalMs,
                                RequestQuality.HIGH_ACCURACY,
                            ),
                        )
                        if (caps.hasNetwork && provider != RawLocation.NETWORK) {
                            add(networkRequest(cadence.lowPowerIntervalMs))
                        }
                        add(passiveRequest())
                    },
                    significantMotion = caps.hasSignificantMotion,
                    recordingProvider = provider,
                )
            }
        }

        private fun networkRequest(intervalMs: Long) =
            ProviderRequest(RawLocation.NETWORK, intervalMs, 0f, intervalMs, RequestQuality.BALANCED_POWER_ACCURACY)

        private fun passiveRequest() =
            ProviderRequest(RawLocation.PASSIVE, PASSIVE_INTERVAL_MS, 0f, PASSIVE_INTERVAL_MS, RequestQuality.LOW_POWER)
    }
}
