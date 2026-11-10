package app.milewage.phone.ui.home

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.milewage.core.sync.Reminder
import app.milewage.phone.R
import app.milewage.phone.logic.Fix
import app.milewage.phone.model.Formats
import app.milewage.phone.platform.SystemScreens
import app.milewage.phone.ui.Texts
import app.milewage.phone.ui.ViewModels
import app.milewage.phone.ui.components.ConfirmHost
import app.milewage.phone.ui.components.LocalSnackbars
import app.milewage.phone.ui.components.otherServerDeleteRequest
import app.milewage.phone.ui.components.rememberConfirmState
import app.milewage.phone.ui.components.rememberNotificationAsk

/** Home with its view model, its messages and the phone's settings pages its fixes open. */
@Composable
fun HomeRoute(
    onOpenShift: (String) -> Unit,
    onOpenShifts: () -> Unit,
    onOpenDiagnostics: () -> Unit,
    onOpenPermissions: () -> Unit,
    onPair: () -> Unit,
    onOpenSettings: () -> Unit,
    vm: HomeViewModel = viewModel(factory = ViewModels.home()),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbars = LocalSnackbars.current
    val confirm = rememberConfirmState()
    val notifications = rememberNotificationAsk { vm.onResume() }
    val res = LocalResources.current

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.onResume() }

    val actions = remember(vm) {
        object : HomeActions {
            override fun start() {
                // The shift's own notification shows its time and distance: ask once, at the first start.
                notifications.askOnce()
                vm.start()
            }

            override fun end() = vm.end()

            override fun closeUnfinished() = vm.closeUnfinished()

            override fun selectPeriod(p: Period) = vm.selectPeriod(p)

            override fun selectVehicle(id: Long) = vm.selectVehicle(id)

            override fun refresh() = vm.refresh()

            override fun fix(f: Fix) = when (f) {
                // "Fix permissions": the permissions screen, which says what each one is for.
                Fix.APP_SETTINGS -> onOpenPermissions()
                Fix.LOCATION_SETTINGS -> SystemScreens.locationSettings(context)
                Fix.BATTERY_SETTINGS -> SystemScreens.batterySettings(context)
                Fix.STORAGE_SETTINGS -> SystemScreens.storageSettings(context)
                Fix.NOTIFICATIONS -> notifications.request()
                Fix.RETRY_VEHICLES -> vm.loadVehicles()
                Fix.SEND_NOW, Fix.CHECK_ADDRESS -> vm.sendNow()
                Fix.PAIR -> onPair()
                Fix.OPEN_SHIFTS -> onOpenShifts()
                Fix.RESUME_RECORDING -> vm.resumeRecording()
                Fix.STOP_SENDING -> vm.stopSending()
                Fix.START_AGAIN -> start()
            }

            override fun saveOdometer(text: String) = vm.saveOdometer(text)

            override fun skipOdometer() = vm.skipOdometer()

            override fun dismissOdometer() = vm.dismissOdometer()

            override fun openDiagnostics() = onOpenDiagnostics()

            override fun reminderShown(level: Reminder.Level) = vm.reminderShown(level)

            override fun connectOtherServer() = onOpenSettings()

            override fun deleteOtherServer() {
                val n = vm.state.value.otherServer.shifts
                if (n > 0) confirm.ask(otherServerDeleteRequest(res, n) { vm.deleteOtherServer() })
            }
        }
    }

    val ended = stringResource(R.string.shift_ended)
    val endedOffline = stringResource(R.string.shift_ended_offline)
    val viewShift = stringResource(R.string.view_shift)
    LaunchedEffect(vm) {
        vm.event.collect { e ->
            when (e) {
                is HomeEvent.StartRefused -> {
                    val fix = e.problem.fix
                    snackbars.show(res.getString(Texts.start(e.problem)), fix?.let { res.getString(Texts.fix(it)) }) {
                        if (fix != null) actions.fix(fix)
                    }
                }
                is HomeEvent.Ended -> snackbars.show(if (e.sent) ended else endedOffline, viewShift) { onOpenShift(e.clientId) }
                HomeEvent.EndFailed -> snackbars.show(res.getString(R.string.end_failed), res.getString(R.string.try_again)) { vm.end() }
                HomeEvent.ResumeFailed -> snackbars.show(res.getString(R.string.resume_failed), res.getString(R.string.fix_app_settings)) {
                    onOpenPermissions()
                }
                HomeEvent.OdometerSaved -> snackbars.show(res.getString(R.string.odometer_saved))
                HomeEvent.OdometerInvalid -> snackbars.show(res.getString(R.string.odometer_invalid, Formats(vm.state.value.settings).unitLabel))
                is HomeEvent.OdometerRefused -> snackbars.show(res.getString(Texts.edit(e.outcome) ?: R.string.edit_failed))
                HomeEvent.StillWaiting -> snackbars.show(res.getString(R.string.sync_still_waiting))
                is HomeEvent.OtherServerDeleted -> snackbars.show(res.getQuantityString(R.plurals.other_server_deleted, e.shifts, e.shifts))
                HomeEvent.DeleteFailed -> snackbars.show(res.getString(R.string.delete_failed))
            }
        }
    }

    HomeContent(state, actions, confirm)
    ConfirmHost(confirm)
}
