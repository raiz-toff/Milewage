package app.milewage.phone.ui

import androidx.annotation.StringRes
import app.milewage.core.sync.ShiftMarker
import app.milewage.phone.R
import app.milewage.phone.logic.BannerKind
import app.milewage.phone.logic.EditOutcome
import app.milewage.phone.logic.Fix
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
}
