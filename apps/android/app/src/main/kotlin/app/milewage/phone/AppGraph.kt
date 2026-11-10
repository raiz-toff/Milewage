package app.milewage.phone

import android.content.Context
import android.os.Build
import app.milewage.data.DeviceInfo
import app.milewage.data.MileWageData
import app.milewage.data.prefs.UiPreferences
import app.milewage.engine.Engine
import app.milewage.phone.logic.DiagnosticsInfo
import app.milewage.phone.logic.DiagnosticsReport
import app.milewage.phone.logic.DiagnosticsSource
import app.milewage.phone.model.ControllerTrackingView
import app.milewage.phone.model.MileWageShiftData
import app.milewage.phone.model.Now
import app.milewage.phone.model.ShiftData
import app.milewage.phone.model.TrackingView
import app.milewage.phone.platform.AndroidBattery
import app.milewage.phone.platform.PairLinkInbox
import app.milewage.phone.platform.ReminderNotifications
import app.milewage.phone.platform.ShiftNoticeSync
import app.milewage.phone.platform.TrackingRecorder
import app.milewage.tracking.TrackingController
import app.milewage.tracking.TrackingDependencies
import app.milewage.tracking.trackingDependencies
import app.milewage.phone.model.AndroidNetView
import app.milewage.phone.model.AppearancePort
import app.milewage.phone.model.ControllerTrackingSettings
import app.milewage.phone.model.MileWagePairing
import app.milewage.phone.model.NetView
import app.milewage.phone.model.PairingPort
import app.milewage.phone.model.PreferencesAppearance
import app.milewage.phone.model.TrackingSettingsPort
import app.milewage.phone.ui.settings.AppInfo
import kotlinx.coroutines.CoroutineScope

/**
 * The app's service locator: every long-lived object, made once per process by [MileWageApp] (no
 * dependency injection framework). View models get what they need from here through their factories
 * (`ui/ViewModels.kt`); screens never reach into it.
 *
 * - [data]: the one `MileWageData` (database, server connection, shift model, sending, diagnostics).
 * - [tracking] and [trackingDependencies]: the tracking module's controller and what its service,
 *   receivers and controller need from the app.
 * - [shiftData], [trackingView]: the seams the view models read (fakes in tests).
 * - [links]: pairing links that opened the app, for first run's Connect screen.
 * - [pairingPort], [netView], [trackingSettings], [appearance]: first run's and Settings' seams.
 * - [uiPreferences]: how the app looks (theme, wallpaper colours).
 */
class AppGraph(context: Context, val scope: CoroutineScope) {
    private val app = context.applicationContext

    val uiPreferences: UiPreferences = UiPreferences(app)

    /**
     * Lazy: the controller's runtime reads [trackingDependencies] from the Application, which needs
     * [data], which needs the recorder over this controller.
     */
    val tracking: TrackingController by lazy { TrackingController.get(app) }

    val data: MileWageData = MileWageData.create(
        context = app,
        anyHttp = BuildConfig.ANY_HTTP,
        appVersion = BuildConfig.VERSION_NAME,
        scope = scope,
        recorder = TrackingRecorder { tracking },
        reminders = ReminderNotifications(app),
        battery = AndroidBattery(app),
    )

    val trackingDependencies: TrackingDependencies = trackingDependencies(
        context = app,
        fixStore = data.fixStore,
        shiftCommands = data.shiftCommands,
        diagnostics = data.trackingDiagnostics,
    )

    val shiftData: ShiftData = MileWageShiftData(data)

    val trackingView: TrackingView by lazy { ControllerTrackingView(tracking) }

    val now: Now = Now.SYSTEM

    val links = PairLinkInbox(status = { data.pairing.status() })

    /** First run's and Settings' seams: pairing, the network (discovery, Tailscale), tracking settings, looks. */
    val pairingPort: PairingPort = MileWagePairing(data)

    val netView: NetView by lazy { AndroidNetView(data.connection?.net) }

    val trackingSettings: TrackingSettingsPort by lazy { ControllerTrackingSettings(tracking) }

    val appearance: AppearancePort = PreferencesAppearance(uiPreferences)

    /** Plain http only to a home address, as the API client enforces (debug builds allow any). */
    val release: Boolean = !BuildConfig.ANY_HTTP

    val appInfo = AppInfo(BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE, Engine.ALGORITHM_VERSION)

    /** The diagnostics screen's reads: versions, states and counts, never a coordinate or the device token. */
    val diagnosticsSource: DiagnosticsSource = object : DiagnosticsSource {
        override suspend fun snapshot(): DiagnosticsInfo {
            val cred = data.pairing.load()?.credential
            val sync = data.sender.status().sync
            return DiagnosticsInfo(
                appVersion = BuildConfig.VERSION_NAME,
                versionCode = BuildConfig.VERSION_CODE,
                buildType = BuildConfig.BUILD_TYPE,
                engineVersion = Engine.ALGORITHM_VERSION,
                android = Build.VERSION.RELEASE ?: "",
                sdk = Build.VERSION.SDK_INT,
                phone = listOfNotNull(Build.MANUFACTURER, Build.MODEL).joinToString(" "),
                pairing = data.pairing.status(),
                route = data.pairing.where,
                homeHost = DiagnosticsReport.hostOf(cred?.homeUrl),
                awayHost = DiagnosticsReport.hostOf(cred?.awayUrl ?: cred?.baseUrl?.takeIf { it != cred.homeUrl }),
                tracking = tracking.status.value,
                permissions = runCatching { tracking.permissions() }.getOrNull(),
                unsentShifts = sync.unsentShifts,
                unsentFixes = sync.unsentFixes,
                halt = sync.halt,
            )
        }

        override fun selfCheck(): List<String> = Engine.selfCheck()
    }

    /** Once, from `Application.onCreate`: recovery, `app.start`, the sending loop, the periodic worker, the notice. */
    fun start() {
        data.start(DeviceInfo(Build.MANUFACTURER ?: "", Build.MODEL ?: "", Build.VERSION.RELEASE ?: "", Build.VERSION.SDK_INT))
        ShiftNoticeSync(data, tracking, shiftData.settings()).start(scope)
    }
}
