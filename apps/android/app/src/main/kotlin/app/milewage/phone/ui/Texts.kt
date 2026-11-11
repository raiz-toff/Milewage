package app.milewage.phone.ui

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.milewage.core.connect.AddressProblem
import app.milewage.core.connect.ConnectFailure
import app.milewage.core.sync.ShiftMarker
import app.milewage.data.prefs.AppTheme
import app.milewage.phone.R
import app.milewage.phone.logic.ConnectError
import app.milewage.phone.logic.ConnectFix
import app.milewage.phone.logic.PermAction
import app.milewage.phone.logic.PermState
import app.milewage.phone.logic.PermStepId
import app.milewage.phone.logic.BannerKind
import app.milewage.phone.logic.EditOutcome
import app.milewage.phone.logic.FlagAdvice
import app.milewage.phone.logic.Fix
import app.milewage.phone.logic.ReconReason
import app.milewage.phone.logic.SetupStep
import app.milewage.phone.logic.ShiftFlag
import app.milewage.phone.logic.StartProblem
import app.milewage.phone.logic.TrackingLine
import app.milewage.phone.logic.TripChoice

/** The words for the decisions' types (package logic), all in strings.xml. A test checks every value has one. */
object Texts {
    @StringRes
    fun fix(f: Fix): Int = when (f) {
        Fix.APP_SETTINGS -> R.string.fix_app_settings
        Fix.LOCATION_SETTINGS -> R.string.fix_location_settings
        Fix.BATTERY_SETTINGS -> R.string.fix_battery_settings
        Fix.STORAGE_SETTINGS -> R.string.fix_storage_settings
        Fix.NOTIFICATIONS -> R.string.fix_notifications
        Fix.RETRY_VEHICLES -> R.string.fix_retry_vehicles
        Fix.SEND_NOW -> R.string.fix_send_now
        Fix.CHECK_ADDRESS -> R.string.fix_check_address
        Fix.PAIR -> R.string.fix_pair
        Fix.OPEN_SHIFTS -> R.string.fix_open_shifts
        Fix.RESUME_RECORDING -> R.string.fix_resume_recording
        Fix.STOP_SENDING -> R.string.fix_stop_sending
        Fix.START_AGAIN -> R.string.fix_start_again
    }

    @StringRes
    fun start(p: StartProblem): Int = when (p) {
        StartProblem.LOCATION_OFF -> R.string.start_location_off
        StartProblem.NO_PERMISSION -> R.string.start_no_permission
        StartProblem.APPROXIMATE_ONLY -> R.string.start_approximate
        StartProblem.NOT_PAIRED -> R.string.start_not_paired
        StartProblem.VEHICLES_NOT_LOADED -> R.string.start_vehicles_not_loaded
        StartProblem.NO_VEHICLES -> R.string.start_no_vehicles
        StartProblem.TRACKER_REFUSED -> R.string.start_tracker_refused
        StartProblem.FAILED -> R.string.start_failed
    }

    /** Title and detail of the running shift's tracking line. */
    fun tracking(t: TrackingLine): Pair<Int, Int> = when (t) {
        TrackingLine.RECORDING -> R.string.track_recording to R.string.track_recording_detail
        TrackingLine.SAVING_BATTERY -> R.string.track_saving_battery to R.string.track_saving_battery_detail
        TrackingLine.STARTING -> R.string.track_starting to R.string.track_starting_detail
        TrackingLine.SERVER_TRACKING_OFF -> R.string.track_server_off to R.string.track_server_off_detail
        TrackingLine.NO_BACKGROUND -> R.string.track_no_background to R.string.track_no_background_detail
        TrackingLine.LOCATION_OFF -> R.string.track_location_off to R.string.track_location_off_detail
        TrackingLine.PERMISSION_LOST -> R.string.track_permission_lost to R.string.track_permission_lost_detail
        TrackingLine.NO_PROVIDER -> R.string.track_no_provider to R.string.track_no_provider_detail
        TrackingLine.NOT_RECORDING -> R.string.track_not_recording to R.string.track_not_recording_detail
    }

    /** The banner's sentence; null for the plain "not yet on server" line alone. */
    @StringRes
    fun banner(k: BannerKind): Int? = when (k) {
        BannerKind.ALL_SENT -> null
        BannerKind.WAITING -> R.string.sync_waiting
        BannerKind.OFFLINE -> R.string.sync_offline
        BannerKind.SENDING -> null
        BannerKind.WRONG_SERVER -> R.string.sync_wrong_server
        BannerKind.REVOKED -> R.string.sync_revoked
        BannerKind.AUTH_PROBLEM -> R.string.sync_auth_problem
        BannerKind.RESTORED -> R.string.sync_restored
        BannerKind.STORAGE_CRITICAL -> R.string.sync_storage_critical
        BannerKind.STORAGE_LOW -> R.string.sync_storage_low
        BannerKind.NEEDS_ATTENTION -> R.string.sync_needs_attention
    }

    fun setup(s: SetupStep): Pair<Int, Int> = when (s) {
        SetupStep.LOCATION -> R.string.setup_location to R.string.setup_location_detail
        SetupStep.ALWAYS -> R.string.setup_always to R.string.setup_always_detail
        SetupStep.NOTIFICATIONS -> R.string.setup_notifications to R.string.setup_notifications_detail
        SetupStep.BATTERY -> R.string.setup_battery to R.string.setup_battery_detail
    }

    @StringRes
    fun marker(m: ShiftMarker): Int = when (m) {
        ShiftMarker.ON_PHONE_ONLY -> R.string.marker_on_phone
        ShiftMarker.SENDING -> R.string.marker_sending
        ShiftMarker.SENT -> R.string.marker_sent
        ShiftMarker.SENT_DIFFERS -> R.string.marker_sent_differs
        ShiftMarker.NEEDS_ATTENTION -> R.string.marker_attention
        ShiftMarker.OTHER_SERVER -> R.string.marker_other_server
    }

    @StringRes
    fun flag(f: ShiftFlag): Int = when (f) {
        ShiftFlag.GAP_COUNTED -> R.string.flag_gap_counted
        ShiftFlag.GAP_LARGE -> R.string.flag_gap_large
        ShiftFlag.GAP_DROPPED -> R.string.flag_gap_dropped
        ShiftFlag.TRACKING_INTERRUPTED -> R.string.flag_tracking_interrupted
        ShiftFlag.SHIFT_AUTO_CLOSED -> R.string.flag_shift_auto_closed
        ShiftFlag.NO_STOPS_DETECTED -> R.string.flag_no_stops_detected
        ShiftFlag.LONG_STOP -> R.string.flag_long_stop
        ShiftFlag.LABEL_ORPHANED -> R.string.flag_label_orphaned
        ShiftFlag.POOR_ACCURACY_SHARE -> R.string.flag_poor_accuracy_share
        ShiftFlag.LOW_FIX_DENSITY -> R.string.flag_low_fix_density
        ShiftFlag.CLOCK_SKEW -> R.string.flag_clock_skew
        ShiftFlag.OVERRIDE_ORPHANED -> R.string.flag_override_orphaned
        ShiftFlag.MANUAL_TRIP_PRESENT -> R.string.flag_manual_trip_present
        ShiftFlag.CALC_MISMATCH -> R.string.flag_calc_mismatch
        ShiftFlag.OTHER -> R.string.flag_other
    }

    @StringRes
    fun advice(a: FlagAdvice): Int = when (a) {
        FlagAdvice.PERMISSIONS -> R.string.advice_permissions
        FlagAdvice.SKY -> R.string.advice_sky
        FlagAdvice.CLOCK -> R.string.advice_clock
        FlagAdvice.END_ON_PHONE -> R.string.advice_end_on_phone
    }

    /** Why the totals differ, never the raw code. */
    @StringRes
    fun reason(r: ReconReason): Int = when (r) {
        ReconReason.POINTS_MISSING -> R.string.reason_points_missing
        ReconReason.CALC_VERSION -> R.string.reason_calc_version
        ReconReason.EDITED_ON_WEB -> R.string.reason_edited_on_web
        ReconReason.LATE_POINTS -> R.string.reason_late_points
        ReconReason.ENGINE_DISAGREEMENT -> R.string.reason_engine_disagreement
        ReconReason.UNKNOWN, ReconReason.OTHER -> R.string.reason_unknown
    }

    @StringRes
    fun choice(c: TripChoice): Int = when (c) {
        TripChoice.BUSINESS -> R.string.kind_business
        TripChoice.ACTIVE -> R.string.kind_active
        TripChoice.DEADHEAD -> R.string.kind_deadhead
        TripChoice.PERSONAL -> R.string.kind_personal
    }

    @StringRes
    fun edit(o: EditOutcome): Int? = when (o) {
        EditOutcome.SAVED -> null
        EditOutcome.FINALIZED -> R.string.edit_finalized
        EditOutcome.NO_SHIFT -> R.string.edit_no_shift
        EditOutcome.NO_TRIP -> R.string.edit_no_trip
        EditOutcome.RUNNING -> R.string.edit_running
        EditOutcome.INVALID -> R.string.edit_invalid
        EditOutcome.FAILED -> R.string.edit_failed
    }

    /** A connect failure's sentence (the Expo app's words, `Reach`'s KDoc). */
    @StringRes
    fun connectErrorRes(e: ConnectError): Int = when (e) {
        ConnectError.NotACode -> R.string.err_not_a_code
        ConnectError.AppTooOld -> R.string.err_app_too_old
        is ConnectError.Address -> when (e.problem) {
            AddressProblem.THIS_COMPUTER -> R.string.err_this_computer
            AddressProblem.INSECURE_OUTSIDE_HOME -> R.string.err_insecure_outside_home
        }
        is ConnectError.Failed -> when (e.failure) {
            is ConnectFailure.HomeUnreachable -> R.string.err_home_unreachable
            ConnectFailure.TailscaleOff -> R.string.err_tailscale_off
            ConnectFailure.TailnetNotAnswering -> R.string.err_tailnet_not_answering
            ConnectFailure.TailscaleUnknown -> R.string.err_tailscale_unknown
            ConnectFailure.InvalidCode -> R.string.err_invalid_code
            ConnectFailure.RateLimited -> R.string.err_rate_limited
            ConnectFailure.NotMileWage -> R.string.err_not_milewage
            ConnectFailure.Unreachable -> R.string.err_unreachable
            ConnectFailure.InsecureAddress -> R.string.err_insecure_address
            ConnectFailure.Other -> R.string.err_other
        }
    }

    /** The sentence with its address filled in (host name only). */
    @Composable
    fun connectError(e: ConnectError): String {
        val f = (e as? ConnectError.Failed)?.failure
        return if (f is ConnectFailure.HomeUnreachable) {
            stringResource(R.string.err_home_unreachable, app.milewage.phone.logic.Hosts.of(f.address) ?: f.address)
        } else {
            stringResource(connectErrorRes(e))
        }
    }

    @StringRes
    fun connectFix(f: ConnectFix): Int = when (f) {
        ConnectFix.TRY_AGAIN -> R.string.try_again
        ConnectFix.OPEN_TAILSCALE -> R.string.tailscale_open
        ConnectFix.SCAN -> R.string.fix_scan
    }

    @StringRes
    fun permTitle(id: PermStepId): Int = when (id) {
        PermStepId.LOCATION_SWITCH -> R.string.perm_switch
        PermStepId.LOCATION -> R.string.perm_location
        PermStepId.ALL_THE_TIME -> R.string.perm_always
        PermStepId.NOTIFICATIONS -> R.string.perm_notifications
        PermStepId.BATTERY -> R.string.perm_battery
        PermStepId.LOCAL_NETWORK -> R.string.perm_local_network
    }

    /** What the step is for, in one sentence. */
    @StringRes
    fun permPurpose(id: PermStepId): Int = when (id) {
        PermStepId.LOCATION_SWITCH -> R.string.perm_switch_purpose
        PermStepId.LOCATION -> R.string.perm_location_purpose
        PermStepId.ALL_THE_TIME -> R.string.perm_always_purpose
        PermStepId.NOTIFICATIONS -> R.string.perm_notifications_purpose
        PermStepId.BATTERY -> R.string.perm_battery_purpose
        PermStepId.LOCAL_NETWORK -> R.string.perm_local_network_purpose
    }

    /** The step's state in words (a switch is on or off, battery use limited or not). */
    @StringRes
    fun permState(id: PermStepId, s: PermState): Int = when {
        id == PermStepId.LOCATION_SWITCH -> if (s == PermState.DONE) R.string.perm_state_on else R.string.perm_state_off
        id == PermStepId.BATTERY -> if (s == PermState.DONE) R.string.perm_state_unlimited else R.string.perm_state_limited
        else -> when (s) {
            PermState.DONE -> R.string.perm_state_done
            PermState.TODO -> R.string.perm_state_todo
            PermState.APPROXIMATE -> R.string.perm_state_approximate
            PermState.BLOCKED -> R.string.perm_state_blocked
            PermState.WAITING -> R.string.perm_state_waiting
        }
    }

    /** The step's one button. ("Allow all the time" uses the system's own label, see the screen.) */
    @StringRes
    fun permAction(id: PermStepId, a: PermAction): Int = when (a) {
        PermAction.NONE -> R.string.perm_state_done
        PermAction.APP_SETTINGS -> R.string.open_app_settings
        PermAction.LOCATION_SETTINGS -> R.string.fix_location_settings
        PermAction.BATTERY_LIST -> R.string.fix_battery_settings
        PermAction.NOTIFICATION_SETTINGS -> R.string.perm_open_notification_settings
        PermAction.REQUEST -> when (id) {
            PermStepId.LOCATION -> R.string.perm_allow_location
            PermStepId.ALL_THE_TIME -> R.string.perm_all_the_time_option
            PermStepId.NOTIFICATIONS -> R.string.fix_notifications
            PermStepId.LOCAL_NETWORK -> R.string.perm_allow_local
            PermStepId.LOCATION_SWITCH -> R.string.fix_location_settings
            PermStepId.BATTERY -> R.string.fix_battery_settings
        }
    }

    @StringRes
    fun theme(t: AppTheme): Int = when (t) {
        AppTheme.SYSTEM -> R.string.theme_system
        AppTheme.LIGHT -> R.string.theme_light
        AppTheme.DARK -> R.string.theme_dark
    }
}
