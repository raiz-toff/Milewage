package app.milewage.phone.model

import app.milewage.core.api.ApiException
import app.milewage.core.connect.FoundServer
import app.milewage.core.connect.Where
import app.milewage.core.pairing.LinkStart
import app.milewage.core.pairing.PairedState
import app.milewage.core.pairing.PairingLink
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.tracking.TrackingSettings
import app.milewage.data.MileWageData
import app.milewage.data.connect.AndroidNet
import app.milewage.data.prefs.AppTheme
import app.milewage.data.prefs.UiPreferences
import app.milewage.tracking.TrackingController
import app.milewage.tracking.TrackingPermissionState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/**
 * Pairing as first run and Settings see it: a thin seam over `MileWageData.pairing` (data/README.md,
 * "Pairing flows") so the view models are tested on the JVM with a fake. Calls that talk to a
 * server throw [ApiException]; the screens turn its code into words with `Reach.explainFailure`.
 */
interface PairingPort {
    fun status(): Flow<PairingStatus>

    /** True from a first connection until the driver finishes the setup steps (Ready > Go to home). */
    fun setupPending(): Flow<Boolean>

    suspend fun finishSetup()

    /** The credential and the last settings read; null when not paired. */
    suspend fun paired(): PairedState?

    /** Home or away for the requests now; null before the first one. */
    fun where(): Where?

    /** `GET /settings` through the paired route: null when it answered, else the failure. */
    suspend fun checkConnection(): ApiException?

    suspend fun redeem(link: PairingLink)

    suspend fun startLink(baseUrl: String): LinkStart

    /** Polls until the driver types the code on the web (slows down on `slow_down`); throws `link_expired`. */
    suspend fun awaitLink(baseUrl: String, start: LinkStart)

    suspend fun hasUnsentData(): Boolean

    /**
     * Refused (false) while the paired server's data waits, unless [confirmed] (the driver read that
     * it stays on this phone for that server). Nothing is deleted. The gate then shows first run.
     */
    suspend fun unpair(confirmed: Boolean): Boolean
}

/** The phone's network as the connect screens need it (over `AndroidNet`). */
interface NetView {
    suspend fun vpnActive(): Boolean?

    suspend fun localNetwork(): Boolean?

    suspend fun discover(): List<FoundServer>

    suspend fun tailscaleInstalled(): Boolean

    suspend fun openTailscale()

    /** Android 17 at targetSdk 37: local network access is a runtime permission (false before). */
    fun localNetworkPermissionNeeded(): Boolean
}

/** Drive detection and the "Still on shift?" reminder (over `TrackingController`). */
interface TrackingSettingsPort {
    suspend fun settings(): TrackingSettings

    suspend fun setDetection(on: Boolean): TrackingController.DetectionResult

    suspend fun setNudgeAfter(ms: Long)

    fun permissions(): TrackingPermissionState
}

/** How the app looks, kept on this phone (over `UiPreferences`). */
interface AppearancePort {
    val theme: Flow<AppTheme>
    val wallpaperColours: Flow<Boolean>

    suspend fun setTheme(theme: AppTheme)

    suspend fun setWallpaperColours(on: Boolean)
}

/** [PairingPort] on the real facade. */
class MileWagePairing(private val data: MileWageData) : PairingPort {
    private val pairing get() = data.pairing

    override fun status(): Flow<PairingStatus> = pairing.statusFlow().distinctUntilChanged()

    // The status flow fires on every pairing change, finishing setup included.
    override fun setupPending(): Flow<Boolean> = pairing.statusFlow().map { pairing.setupPending() }.distinctUntilChanged()

    override suspend fun finishSetup() = pairing.finishSetup()

    override suspend fun paired(): PairedState? = pairing.load()

    override fun where(): Where? = pairing.where

    override suspend fun checkConnection(): ApiException? {
        val state = pairing.load() ?: return null
        return pairing.refreshSettings(state).second
    }

    override suspend fun redeem(link: PairingLink) {
        pairing.redeem(link)
        data.kick()
    }

    override suspend fun startLink(baseUrl: String): LinkStart = pairing.startLink(baseUrl)

    override suspend fun awaitLink(baseUrl: String, start: LinkStart) {
        pairing.awaitLink(baseUrl, start)
        data.kick()
    }

    override suspend fun hasUnsentData(): Boolean = data.hasUnsentData()

    override suspend fun unpair(confirmed: Boolean): Boolean = data.unpair(confirmed)
}

/** [NetView] on `AndroidNet`; without a connection (never on the phone) nothing is found. */
class AndroidNetView(private val net: AndroidNet?) : NetView {
    override suspend fun vpnActive(): Boolean? = net?.vpnActive()

    override suspend fun localNetwork(): Boolean? = net?.localNetwork()

    override suspend fun discover(): List<FoundServer> = net?.discover() ?: emptyList()

    override suspend fun tailscaleInstalled(): Boolean = net?.tailscaleInstalled() ?: false

    override suspend fun openTailscale() {
        net?.openTailscale()
    }

    override fun localNetworkPermissionNeeded(): Boolean = net?.localNetworkPermissionNeeded() ?: false
}

class ControllerTrackingSettings(private val c: TrackingController) : TrackingSettingsPort {
    override suspend fun settings(): TrackingSettings = c.settings()

    override suspend fun setDetection(on: Boolean): TrackingController.DetectionResult = c.setDetection(on)

    override suspend fun setNudgeAfter(ms: Long) = c.updateSettings(c.settings().copy(nudgeAfterMs = ms))

    override fun permissions(): TrackingPermissionState = c.permissions()
}

class PreferencesAppearance(private val prefs: UiPreferences) : AppearancePort {
    override val theme: Flow<AppTheme> get() = prefs.theme
    override val wallpaperColours: Flow<Boolean> get() = prefs.useWallpaperColours

    override suspend fun setTheme(theme: AppTheme) = prefs.setTheme(theme)

    override suspend fun setWallpaperColours(on: Boolean) = prefs.setUseWallpaperColours(on)
}
