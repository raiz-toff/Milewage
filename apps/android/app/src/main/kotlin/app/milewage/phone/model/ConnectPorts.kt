package app.milewage.phone.model

import app.milewage.core.api.ApiException
import app.milewage.core.connect.Where
import app.milewage.core.pairing.PairedState
import app.milewage.core.pairing.PairingLink
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.tracking.TrackingSettings
import app.milewage.data.MileWageData
import app.milewage.data.connect.AndroidNet
import app.milewage.data.prefs.AppTheme
import app.milewage.data.prefs.UiPreferences
import app.milewage.tracking.TrackingController
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

    suspend fun tailscaleInstalled(): Boolean

    suspend fun openTailscale()
}

/** The "Still on shift?" reminder (over `TrackingController`). */
interface TrackingSettingsPort {
    suspend fun settings(): TrackingSettings

    suspend fun setNudgeAfter(ms: Long)
}

/** How the app looks, kept on this phone (over `UiPreferences`). */
interface AppearancePort {
    val theme: Flow<AppTheme>
    val wallpaperColours: Flow<Boolean>

    suspend fun setTheme(theme: AppTheme)

    suspend fun setWallpaperColours(on: Boolean)

    /** Settings > Accent (Lane yellow unless the driver picked another to try). */
    val accent: Flow<app.milewage.data.prefs.Accent> get() = kotlinx.coroutines.flow.flowOf(app.milewage.data.prefs.Accent.LANE)

    suspend fun setAccent(accent: app.milewage.data.prefs.Accent) {}
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

    override suspend fun hasUnsentData(): Boolean = data.hasUnsentData()

    override suspend fun unpair(confirmed: Boolean): Boolean = data.unpair(confirmed)
}

/** [NetView] on `AndroidNet`; without a connection (never on the phone) nothing is installed. */
class AndroidNetView(private val net: AndroidNet?) : NetView {
    override suspend fun vpnActive(): Boolean? = net?.vpnActive()

    override suspend fun tailscaleInstalled(): Boolean = net?.tailscaleInstalled() ?: false

    override suspend fun openTailscale() {
        net?.openTailscale()
    }

}

class ControllerTrackingSettings(private val c: TrackingController) : TrackingSettingsPort {
    override suspend fun settings(): TrackingSettings = c.settings()

    override suspend fun setNudgeAfter(ms: Long) = c.updateSettings(c.settings().copy(nudgeAfterMs = ms))
}

class PreferencesAppearance(private val prefs: UiPreferences) : AppearancePort {
    override val theme: Flow<AppTheme> get() = prefs.theme
    override val wallpaperColours: Flow<Boolean> get() = prefs.useWallpaperColours

    override suspend fun setTheme(theme: AppTheme) = prefs.setTheme(theme)

    override suspend fun setWallpaperColours(on: Boolean) = prefs.setUseWallpaperColours(on)

    override val accent: Flow<app.milewage.data.prefs.Accent> get() = prefs.accent

    override suspend fun setAccent(accent: app.milewage.data.prefs.Accent) = prefs.setAccent(accent)
}
