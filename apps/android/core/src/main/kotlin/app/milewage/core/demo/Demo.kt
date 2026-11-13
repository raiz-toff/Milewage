package app.milewage.core.demo

import app.milewage.core.api.DiagnosticsLevel
import app.milewage.core.api.DiagnosticsSettings
import app.milewage.core.api.DistanceUnit
import app.milewage.core.api.MileageRate
import app.milewage.core.api.Modules
import app.milewage.core.api.OwnMileageRate
import app.milewage.core.api.OwnRateStep
import app.milewage.core.api.Settings
import app.milewage.core.pairing.Credential
import app.milewage.core.pairing.PairingLink
import app.milewage.core.shift.VehicleRecord

/**
 * "Try it without a server": the phone pairs with [DemoServer], a MileWage server that lives in
 * the app's own process, so every screen works without one (Google Play's reviewers, a driver who
 * wants to look first). Shifts are recorded for real (GPS, the notification, the foreground
 * service) and stay on the phone: the demo server answers in memory and nothing leaves the phone.
 *
 * Demo mode is not a flag of its own: the phone is in demo mode while its credential points at
 * [BASE_URL]. Leaving it (or connecting a real server) deletes everything bound to [INSTANCE].
 */
object Demo {
    /**
     * The demo server's address. `.invalid` is reserved (RFC 2606) and never resolves, so even a
     * request that slipped past [DemoServer.routing] could not reach anyone.
     */
    const val HOST = "demo.milewage.invalid"
    const val BASE_URL = "https://$HOST"

    /** `X-MileWage-Instance` of the demo server: every demo shift is bound to it. */
    const val INSTANCE = "milewage-demo"

    /** The pairing link the demo button redeems (the demo server takes any code). */
    val LINK = PairingLink(baseUrl = BASE_URL, token = "mwp_demo")

    /** Shift client ids of the sample shifts start with this. */
    const val SAMPLE_PREFIX = "demo-sample-"

    /** When the phone entered demo mode (bookkeeping), so leaving deletes only what the demo added. */
    const val KEY_SINCE = "demo.since"

    const val TIMEZONE = "America/Toronto"

    /** The two sample vehicles; ids far from a real server's. */
    val VEHICLES = listOf(
        VehicleRecord(id = 900_001, name = "Prius", kind = "car", plate = "DEMO 101"),
        VehicleRecord(id = 900_002, name = "RAV4", kind = "car", plate = "DEMO 202"),
    )

    val VEHICLE_IDS: Set<Long> = VEHICLES.map { it.id }.toSet()

    fun isDemo(credential: Credential?): Boolean = credential?.baseUrl?.trimEnd('/') == BASE_URL

    /**
     * The demo server's settings: Canada, kilometres, Canadian dollars, Toronto time, and a two-step
     * rate of the CRA's shape (72 cents a kilometre for the first 5,000, then 66), so Home shows a
     * deduction value. Diagnostics are off: the demo records nothing for a server.
     */
    fun settings(year: String): Settings = Settings(
        country = "CA",
        distanceUnit = DistanceUnit.KM,
        currency = "CAD",
        timezone = TIMEZONE,
        stopsEnabled = true,
        engineVersion = app.milewage.engine.Engine.ALGORITHM_VERSION,
        diagnostics = DiagnosticsSettings(DiagnosticsLevel.OFF),
        modules = Modules(tracking = true, stops = true, sync = true, diagnostics = false, devices = true),
        helpEnabled = false,
        region = "ON",
        ownMileageRate = OwnMileageRate(
            centsPerUnit = 72.0,
            unit = DistanceUnit.KM,
            step = OwnRateStep(thresholdUnits = 5_000, centsPerUnitAfter = 66.0, periodStart = "$year-01-01"),
        ),
        mileageRate = MileageRate.YOURS,
        weekStart = 1,
        timeFormat = "12h",
        defaultVehicleId = VEHICLES.first().id,
    )
}
