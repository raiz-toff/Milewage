package app.milewage.phone.ui.settings

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.milewage.core.connect.Where
import app.milewage.core.format.DistanceUnit
import app.milewage.core.format.TimeFormat
import app.milewage.data.prefs.AppTheme
import app.milewage.phone.R
import app.milewage.phone.logic.ConnectFix
import app.milewage.phone.logic.ConnectionCheck
import app.milewage.phone.logic.Fix
import app.milewage.phone.logic.HelpLinks
import app.milewage.phone.logic.NudgeChoices
import app.milewage.phone.model.Countries
import app.milewage.phone.platform.SystemScreens
import app.milewage.phone.ui.Texts
import app.milewage.phone.ui.ViewModels
import app.milewage.phone.ui.components.ConfirmHost
import app.milewage.phone.ui.components.ConfirmRequest
import app.milewage.phone.ui.components.ListRow
import app.milewage.phone.ui.components.LocalSnackbars
import app.milewage.phone.ui.components.NoticeCard
import app.milewage.phone.ui.components.OtherServerCard
import app.milewage.phone.ui.components.otherServerDeleteRequest
import app.milewage.phone.ui.components.RowDivider
import app.milewage.phone.ui.components.Rows
import app.milewage.phone.ui.components.Screen
import app.milewage.phone.ui.components.Tone
import app.milewage.phone.ui.components.rememberConfirmState
import app.milewage.phone.ui.icons.Icons
import app.milewage.phone.ui.theme.wallpaperColoursAvailable
import kotlinx.coroutines.launch

/** The public source of MileWage (AGPL-3.0: the README's repository). */
const val SOURCE_URL = "https://github.com/raiz-toff/Milewage"

/** What Settings' rows do. */
interface SettingsActions {
    fun check()

    fun openTailscale()

    fun disconnect()

    fun setDetection(on: Boolean)

    fun fix(f: Fix)

    fun setNudge(minutes: Int)

    fun setTheme(theme: AppTheme)

    fun setWallpaper(on: Boolean)

    fun sendNow()

    fun openHelp(page: HelpLinks.Page)

    fun openPermissions()

    fun openLicences()

    fun openSource()

    fun openDiagnostics()

    /** Another server's shifts: delete them from the phone (asks first). */
    fun deleteOtherServer()
}

@Composable
fun SettingsRoute(
    onOpenPermissions: () -> Unit,
    onOpenLicences: () -> Unit,
    onOpenDiagnostics: () -> Unit,
    info: AppInfo,
    vm: SettingsViewModel = viewModel(factory = ViewModels.settings()),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val res = LocalResources.current
    val snackbars = LocalSnackbars.current
    val confirm = rememberConfirmState()
    val scope = rememberCoroutineScope()
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { vm.onResume() }

    fun browse(url: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            scope.launch { snackbars.show(res.getString(R.string.browser_missing)) }
        }
    }

    val actions = remember(vm) {
        object : SettingsActions {
            override fun check() = vm.check()

            override fun openTailscale() = vm.openTailscale()

            override fun disconnect() = vm.disconnect()

            override fun setDetection(on: Boolean) = vm.setDetection(on)

            override fun fix(f: Fix) = when (f) {
                Fix.LOCATION_SETTINGS -> SystemScreens.locationSettings(context)
                Fix.START_AGAIN -> vm.setDetection(true)
                else -> onOpenPermissions()
            }

            override fun setNudge(minutes: Int) = vm.setNudge(minutes)

            override fun setTheme(theme: AppTheme) = vm.setTheme(theme)

            override fun setWallpaper(on: Boolean) = vm.setWallpaper(on)

            override fun sendNow() = vm.sendNow()

            override fun openHelp(page: HelpLinks.Page) {
                state.helpBase?.let { browse(it + page.path) }
            }

            override fun openPermissions() = onOpenPermissions()

            override fun openLicences() = onOpenLicences()

            override fun openSource() = browse(SOURCE_URL)

            override fun openDiagnostics() = onOpenDiagnostics()

            override fun deleteOtherServer() {
                val n = vm.state.value.otherServer.shifts
                if (n > 0) confirm.ask(otherServerDeleteRequest(res, n) { vm.deleteOtherServer() })
            }
        }
    }

    LaunchedEffect(vm) {
        vm.events.collect { e ->
            when (e) {
                is SettingsEvent.AskUnpair -> confirm.ask(
                    ConfirmRequest(
                        title = res.getString(R.string.unpair_title),
                        text = res.getString(R.string.unpair_text, e.host),
                        confirmLabel = res.getString(R.string.unpair_confirm),
                        destructive = true,
                        onConfirm = { vm.confirmDisconnect() },
                    ),
                )
                is SettingsEvent.AskLeaveUnsent -> confirm.ask(
                    ConfirmRequest(
                        title = res.getString(R.string.unpair_unsent_title),
                        text = res.getString(
                            R.string.unpair_unsent_text,
                            res.getQuantityString(R.plurals.sync_unsent_shifts, e.shifts, e.shifts),
                            e.host,
                        ),
                        confirmLabel = res.getString(R.string.unpair_anyway),
                        destructive = true,
                        onConfirm = { vm.confirmDisconnect(confirmed = true) },
                    ),
                )
                SettingsEvent.EndShiftFirst -> snackbars.show(res.getString(R.string.unpair_running))
                SettingsEvent.Disconnected -> snackbars.show(res.getString(R.string.unpair_done))
                SettingsEvent.DisconnectFailed -> snackbars.show(res.getString(R.string.unpair_failed), res.getString(R.string.try_again)) { vm.disconnect() }
                is SettingsEvent.Sent -> snackbars.show(res.getString(if (e.done) R.string.sync_all_sent else R.string.sync_still_waiting))
                is SettingsEvent.OtherServerDeleted -> snackbars.show(res.getQuantityString(R.plurals.other_server_deleted, e.shifts, e.shifts))
                SettingsEvent.DeleteFailed -> snackbars.show(res.getString(R.string.delete_failed))
                is SettingsEvent.Detection -> {
                    val fix = e.outcome.fix
                    snackbars.show(res.getString(Texts.detection(e.outcome)), fix?.let { res.getString(Texts.fix(it)) }) { fix?.let(actions::fix) }
                }
            }
        }
    }

    SettingsContent(state, info, actions)
    ConfirmHost(confirm)
}

@Composable
fun SettingsContent(state: SettingsState, info: AppInfo, actions: SettingsActions) {
    var nudgeOpen by rememberSaveable { mutableStateOf(false) }
    var themeOpen by rememberSaveable { mutableStateOf(false) }
    Screen(title = stringResource(R.string.nav_settings)) {
        item(key = "server") { ServerSection(state, actions) }
        item(key = "phone") {
            Rows(label = stringResource(R.string.settings_phone)) {
                ListRow(
                    headline = stringResource(R.string.settings_permissions),
                    supporting = stringResource(R.string.settings_permissions_body),
                    leading = { Icon(Icons.Location, null) },
                    trailing = { Icon(Icons.ChevronRight, null) },
                    onClick = actions::openPermissions,
                )
                RowDivider()
                // Destructive: Material's error colour, and it asks first.
                ListRow(
                    headline = stringResource(R.string.settings_disconnect),
                    supporting = state.facts?.let { stringResource(R.string.settings_disconnect_body, it.host) },
                    leading = { Icon(Icons.Close, null, tint = MaterialTheme.colorScheme.error) },
                    headlineColor = MaterialTheme.colorScheme.error,
                    onClick = actions::disconnect,
                )
            }
        }
        item(key = "tracking") { TrackingSection(state, actions) { nudgeOpen = true } }
        item(key = "sending") { SendingSection(state, actions) }
        item(key = "appearance") {
            Rows(label = stringResource(R.string.settings_appearance)) {
                ListRow(
                    headline = stringResource(R.string.settings_theme),
                    supporting = stringResource(Texts.theme(state.theme)),
                    leading = { Icon(Icons.Palette, null) },
                    onClick = { themeOpen = true },
                )
                RowDivider()
                ListRow(
                    headline = stringResource(R.string.settings_wallpaper_colours),
                    supporting = stringResource(
                        if (wallpaperColoursAvailable) R.string.settings_wallpaper_colours_body else R.string.settings_wallpaper_colours_unavailable,
                    ),
                    trailing = { Switch(checked = state.wallpaper && wallpaperColoursAvailable, enabled = wallpaperColoursAvailable, onCheckedChange = null) },
                    onClick = if (wallpaperColoursAvailable) ({ actions.setWallpaper(!state.wallpaper) }) else null,
                    role = Role.Switch,
                )
            }
        }
        item(key = "units") { UnitsSection(state) }
        if (state.helpBase != null) item(key = "help") { HelpSection(actions) }
        item(key = "about") {
            Rows(label = stringResource(R.string.settings_about)) {
                ListRow(stringResource(R.string.settings_version), supporting = stringResource(R.string.settings_version_value, info.version, info.build))
                RowDivider()
                ListRow(stringResource(R.string.settings_engine), supporting = stringResource(R.string.settings_engine_value, info.engine))
                RowDivider()
                ListRow(
                    stringResource(R.string.settings_licences),
                    supporting = stringResource(R.string.settings_licences_body),
                    leading = { Icon(Icons.Licences, null) },
                    trailing = { Icon(Icons.ChevronRight, null) },
                    onClick = actions::openLicences,
                )
                RowDivider()
                ListRow(
                    stringResource(R.string.settings_source),
                    supporting = stringResource(R.string.settings_source_body),
                    leading = { Icon(Icons.Code, null) },
                    trailing = { Icon(Icons.OpenInNew, null) },
                    onClick = actions::openSource,
                )
                RowDivider()
                ListRow(
                    headline = stringResource(R.string.settings_diagnostics),
                    supporting = stringResource(R.string.settings_diagnostics_body),
                    leading = { Icon(Icons.Maintenance, null) },
                    trailing = { Icon(Icons.ChevronRight, null) },
                    onClick = actions::openDiagnostics,
                )
            }
        }
    }
    if (nudgeOpen) {
        val current = (state.nudgeMs / 60_000).toInt()
        ChoiceDialog(
            title = stringResource(R.string.nudge_dialog_title),
            text = stringResource(R.string.nudge_dialog_text),
            choices = NudgeChoices.of(state.nudgeMs),
            selected = current,
            label = { nudgeLabel(it) },
            onPick = {
                actions.setNudge(it)
                nudgeOpen = false
            },
            onDismiss = { nudgeOpen = false },
        )
    }
    if (themeOpen) {
        ChoiceDialog(
            title = stringResource(R.string.settings_theme),
            text = null,
            choices = AppTheme.entries,
            selected = state.theme,
            label = { stringResource(Texts.theme(it)) },
            onPick = {
                actions.setTheme(it)
                themeOpen = false
            },
            onDismiss = { themeOpen = false },
        )
    }
}

@Composable
private fun nudgeLabel(minutes: Int): String =
    if (minutes == 0) stringResource(R.string.nudge_off) else pluralStringResource(R.plurals.nudge_minutes, minutes, minutes)

/** The server: its two addresses (host names), which one the phone uses, and the connection. */
@Composable
private fun ServerSection(state: SettingsState, actions: SettingsActions) {
    val f = state.facts
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Rows(label = stringResource(R.string.settings_server)) {
            if (f == null) {
                ListRow(stringResource(R.string.settings_not_paired))
                return@Rows
            }
            ListRow(
                headline = stringResource(R.string.row_home),
                supporting = f.homeHost?.let { if (state.where == Where.HOME) stringResource(R.string.settings_using_now, it) else it }
                    ?: stringResource(R.string.not_set),
                leading = { Icon(Icons.Wifi, null) },
            )
            RowDivider()
            ListRow(
                headline = stringResource(R.string.row_away),
                supporting = f.awayHost?.let { if (state.where == Where.AWAY) stringResource(R.string.settings_using_now, it) else it }
                    ?: stringResource(R.string.away_not_set),
                leading = { Icon(Icons.Tailscale, null) },
            )
            RowDivider()
            ListRow(
                headline = stringResource(R.string.settings_connection),
                supporting = when (val c = state.check) {
                    ConnectionCheck.Checking -> stringResource(R.string.checking)
                    is ConnectionCheck.Ok -> stringResource(
                        when (c.where) {
                            Where.HOME -> R.string.connection_home
                            Where.AWAY -> R.string.connection_away
                            null -> R.string.connection_ok
                        },
                    )
                    is ConnectionCheck.Failed -> stringResource(R.string.connection_failed)
                },
                leading = { Icon(Icons.Server, null) },
                trailing = {
                    if (state.check == ConnectionCheck.Checking) {
                        CircularProgressIndicator(Modifier.padding(4.dp), strokeWidth = 2.dp)
                    } else {
                        OutlinedButton(onClick = actions::check, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.settings_check)) }
                    }
                },
            )
        }
        val c = state.check
        if (c is ConnectionCheck.Failed) {
            val fix = if (c.error.fix == ConnectFix.OPEN_TAILSCALE) ConnectFix.OPEN_TAILSCALE else ConnectFix.TRY_AGAIN
            NoticeCard(
                title = Texts.connectError(c.error),
                icon = Icons.WifiOff,
                tone = Tone.PROBLEM,
                actionLabel = stringResource(Texts.connectFix(fix)),
                onAction = { if (fix == ConnectFix.OPEN_TAILSCALE) actions.openTailscale() else actions.check() },
            )
        }
    }
}

@Composable
private fun TrackingSection(state: SettingsState, actions: SettingsActions, onNudge: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Rows(label = stringResource(R.string.settings_tracking)) {
            ListRow(
                headline = stringResource(R.string.settings_detection),
                supporting = stringResource(R.string.settings_detection_body),
                trailing = {
                    if (state.detectionBusy) {
                        CircularProgressIndicator(Modifier.padding(4.dp), strokeWidth = 2.dp)
                    } else {
                        Switch(checked = state.detection, onCheckedChange = null)
                    }
                },
                onClick = { actions.setDetection(!state.detection) },
                role = Role.Switch,
            )
            RowDivider()
            ListRow(
                headline = stringResource(R.string.settings_nudge),
                supporting = nudgeLabel((state.nudgeMs / 60_000).toInt()),
                leading = { Icon(Icons.Timer, null) },
                onClick = onNudge,
            )
            RowDivider()
            ListRow(
                headline = stringResource(R.string.settings_battery_saving),
                supporting = stringResource(R.string.settings_battery_saving_body),
                leading = { Icon(Icons.BatterySaving, null) },
            )
        }
        state.detectionProblem?.let { p ->
            NoticeCard(
                title = stringResource(Texts.detection(p)),
                icon = Icons.Warning,
                tone = Tone.WARNING,
                actionLabel = p.fix?.let { stringResource(Texts.fix(it)) },
                onAction = p.fix?.let { f -> { actions.fix(f) } },
            )
        }
    }
}

@Composable
private fun SendingSection(state: SettingsState, actions: SettingsActions) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SendingRows(state, actions)
        // Another server's shifts: connecting to it is "Connect to a different server" (asks first).
        OtherServerCard(state.otherServer, onConnect = actions::disconnect, onDelete = actions::deleteOtherServer)
    }
}

@Composable
private fun SendingRows(state: SettingsState, actions: SettingsActions) {
    Rows(label = stringResource(R.string.settings_sending)) {
        val waiting = state.unsentShifts > 0 || state.unsentFixes > 0
        ListRow(
            headline = stringResource(if (waiting) R.string.settings_waiting else R.string.sync_all_sent),
            supporting = if (waiting) {
                listOf(
                    pluralStringResource(R.plurals.sync_unsent_shifts, state.unsentShifts, state.unsentShifts),
                    pluralStringResource(R.plurals.sync_unsent_points, state.unsentFixes.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(), state.unsentFixes),
                ).joinToString(" · ")
            } else {
                null
            },
            leading = { Icon(if (waiting) Icons.Send else Icons.CheckCircle, null) },
            trailing = {
                if (state.sending) {
                    CircularProgressIndicator(Modifier.padding(4.dp), strokeWidth = 2.dp)
                } else if (waiting) {
                    OutlinedButton(onClick = actions::sendNow, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.fix_send_now)) }
                }
            },
        )
    }
}

/** Units and formats come from the server's settings; they are changed on the web. */
@Composable
private fun UnitsSection(state: SettingsState) {
    val d = state.display
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Rows(label = stringResource(R.string.settings_units)) {
            ListRow(stringResource(R.string.units_distance), supporting = stringResource(if (d.unit == DistanceUnit.MI) R.string.units_miles else R.string.units_km), leading = { Icon(Icons.Units, null) })
            RowDivider()
            ListRow(stringResource(R.string.units_currency), supporting = d.currency)
            RowDivider()
            ListRow(stringResource(R.string.units_timezone), supporting = d.timezone)
            RowDivider()
            ListRow(stringResource(R.string.units_time_format), supporting = stringResource(if (d.timeFormat == TimeFormat.H12) R.string.units_12h else R.string.units_24h))
            RowDivider()
            ListRow(stringResource(R.string.units_week_start), supporting = stringResource(if (d.weekStart == 0) R.string.units_sunday else R.string.units_monday))
            if (d.country.isNotBlank()) {
                RowDivider()
                ListRow(stringResource(R.string.row_country), supporting = Countries.name(d.country))
            }
        }
        Text(
            stringResource(R.string.units_on_web),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
    }
}

@Composable
private fun HelpSection(actions: SettingsActions) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Rows(label = stringResource(R.string.settings_help)) {
            listOf(
                HelpLinks.Page.GETTING_STARTED to R.string.help_getting_started,
                HelpLinks.Page.PHONES to R.string.help_phones,
                HelpLinks.Page.TROUBLESHOOTING to R.string.help_troubleshooting,
                HelpLinks.Page.INDEX to R.string.help_index,
            ).forEachIndexed { i, (page, label) ->
                if (i > 0) RowDivider()
                ListRow(
                    headline = stringResource(label),
                    leading = { Icon(Icons.Help, null) },
                    trailing = { Icon(Icons.OpenInNew, null) },
                    onClick = { actions.openHelp(page) },
                )
            }
        }
        Text(
            stringResource(R.string.help_note),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp),
        )
    }
}

/** A Material choice dialog: one radio per choice, chosen at a tap. */
@Composable
private fun <T> ChoiceDialog(
    title: String,
    text: String?,
    choices: List<T>,
    selected: T,
    label: @Composable (T) -> String,
    onPick: (T) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                if (text != null) Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(bottom = 8.dp))
                Column(Modifier.selectableGroup()) {
                    choices.forEach { c ->
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = c == selected, role = Role.RadioButton, onClick = { onPick(c) }),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = c == selected, onClick = null)
                            Text(label(c), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 16.dp))
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}
