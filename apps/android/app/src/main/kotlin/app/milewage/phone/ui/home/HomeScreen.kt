package app.milewage.phone.ui.home

import app.milewage.phone.ui.icons.Icons
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.sync.Reminder
import app.milewage.data.RunningShiftView
import app.milewage.phone.BuildConfig
import app.milewage.phone.R
import app.milewage.phone.ui.components.CardSurface
import app.milewage.phone.logic.BannerKind
import app.milewage.phone.logic.Fix
import app.milewage.phone.logic.TrackingLine
import app.milewage.phone.model.Formats
import app.milewage.phone.ui.Texts
import app.milewage.phone.ui.components.BigFigure
import app.milewage.phone.ui.components.BottomAction
import app.milewage.phone.ui.components.BrandButton
import app.milewage.phone.ui.components.BrandSize
import app.milewage.phone.ui.components.ConfirmRequest
import app.milewage.phone.ui.components.ConfirmState
import app.milewage.phone.ui.components.ElapsedFigure
import app.milewage.phone.ui.components.LocalNow
import app.milewage.phone.ui.components.LocalTicking
import app.milewage.phone.ui.components.NoticeCard
import app.milewage.phone.ui.components.OtherServerCard
import app.milewage.phone.ui.components.Screen
import app.milewage.phone.ui.components.Tone

/** What Home's buttons do; the route connects them to the view model and the phone. */
interface HomeActions {
    fun start()

    fun end()

    fun closeUnfinished()

    fun selectPeriod(p: Period)

    fun selectVehicle(id: Long)

    fun refresh()

    fun fix(f: Fix)

    fun saveOdometer(text: String)

    fun skipOdometer()

    fun dismissOdometer()

    fun openDiagnostics()

    fun reminderShown(level: Reminder.Level)

    /** Another server's shifts: connect to that server again (Settings > Connect to a different server). */
    fun connectOtherServer()

    /** Another server's shifts: delete them from the phone (asks first). */
    fun deleteOtherServer()
}

/** Home, a thin renderer of [HomeState]: the next shift, or the running shift. */
@Composable
fun HomeContent(state: HomeState, actions: HomeActions, confirm: ConfirmState) {
    val running = state.running
    if (running != null) {
        RunningShiftContent(state, running, actions, confirm)
    } else {
        IdleContent(state, actions)
    }
    state.odometer?.let { ask ->
        OdometerDialog(ask, Formats(state.settings).unitLabel, actions::saveOdometer, actions::skipOdometer, actions::dismissOdometer)
    }
}

@Composable
private fun DiagnosticsAction(actions: HomeActions) {
    // Debug builds: one tap. Every build: a long press on the title.
    if (BuildConfig.DEBUG) {
        IconButton(onClick = actions::openDiagnostics) {
            Icon(Icons.Maintenance, contentDescription = stringResource(R.string.home_open_diagnostics))
        }
    }
}

@Composable
private fun IdleContent(state: HomeState, actions: HomeActions) {
    val f = Formats(state.settings)
    val now = LocalNow.current.ms()
    Screen(
        title = stringResource(R.string.home_title),
        subtitle = f.longDay(f.dayOf(now)),
        onTitleLongClick = actions::openDiagnostics,
        titleLongClickLabel = stringResource(R.string.home_open_diagnostics),
        actions = { DiagnosticsAction(actions) },
        onRefresh = actions::refresh,
        refreshing = state.refreshing,
        bottomBar = {
            if (state.ready) {
                BottomAction {
                    val starting = state.busy == Busy.START
                    // The one brand action: lane yellow (primaryContainer), 64 dp, easy to hit in a mount.
                    BrandButton(
                        text = stringResource(if (starting) R.string.starting_shift else R.string.start_shift),
                        onClick = actions::start,
                        icon = Icons.Play,
                        busy = starting,
                        size = BrandSize.VEHICLE,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        },
    ) {
        if (state.ready && state.setup.any { !it.done }) item(key = "setup") { SetupCard(state.setup, actions::fix) }
        item(key = "summary") {
            val s = state.summary
            SummarySection(
                summary = when (state.period) {
                    Period.DAY -> s?.day
                    Period.WEEK -> s?.week
                    Period.MONTH -> s?.month
                },
                period = state.period,
                settings = state.settings,
                onPeriod = actions::selectPeriod,
            )
        }
        state.banner?.let { b -> item(key = "banner") { SyncBannerCard(b, state.sending, actions::fix, actions::reminderShown) } }
        if (!state.otherServer.none) {
            item(key = "other-server") { OtherServerCard(state.otherServer, actions::connectOtherServer, actions::deleteOtherServer) }
        }
        item(key = "next") {
            NextShiftCard(state.vehicles, state.pairing == PairingStatus.UNPAIRED, actions::selectVehicle, actions::fix)
        }
    }
}

/**
 * The running shift, readable at a glance in a vehicle mount: the time and the distance large, the
 * deduction so far (an estimate), the tracker's state in words with its fix, whether the shift is on
 * the server, and one End shift button (64 dp) that asks first.
 */
@Composable
private fun RunningShiftContent(state: HomeState, running: RunningShiftView, actions: HomeActions, confirm: ConfirmState) {
    val f = Formats(state.settings)
    val shift = running.shift
    val distance = f.distance(running.distanceM)
    val endTitle = stringResource(R.string.end_confirm_title)
    val endText = stringResource(R.string.end_confirm_text, distance)
    val endLabel = stringResource(R.string.end_shift)
    val keep = stringResource(R.string.end_keep)
    val closeTitle = stringResource(R.string.close_unfinished_title)
    val closeText = stringResource(R.string.close_unfinished_text)
    val closeLabel = stringResource(R.string.close_confirm)
    val line = state.trackingLine ?: TrackingLine.STARTING
    Screen(
        title = stringResource(R.string.running_title),
        subtitle = listOfNotNull(running.vehicle?.name, stringResource(R.string.running_since, f.clock(shift.startedAt))).joinToString(" · "),
        onTitleLongClick = actions::openDiagnostics,
        titleLongClickLabel = stringResource(R.string.home_open_diagnostics),
        actions = { DiagnosticsAction(actions) },
        bottomBar = {
            BottomAction {
                val ending = state.busy == Busy.END
                Button(
                    onClick = {
                        confirm.ask(ConfirmRequest(endTitle, endText, endLabel, destructive = true, dismissLabel = keep, onConfirm = actions::end))
                    },
                    enabled = !ending,
                    colors = ButtonDefaults.buttonColors(
                        // Destructive is Material's error (the design skill); spent is for money only.
                        containerColor = MaterialTheme.colorScheme.errorContainer,
                        contentColor = MaterialTheme.colorScheme.onErrorContainer,
                    ),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
                ) {
                    if (ending) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onErrorContainer)
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(stringResource(if (ending) R.string.ending_shift else R.string.end_shift), style = MaterialTheme.typography.titleMedium)
                }
            }
        },
    ) {
        item(key = "live") {
            val live = line == TrackingLine.RECORDING || line == TrackingLine.SAVING_BATTERY || line == TrackingLine.NO_BACKGROUND
            if (live && LocalTicking.current) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
            } else {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
        item(key = "readings") {
            CardSurface(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Reading(stringResource(R.string.reading_time), null) { mod ->
                        ElapsedFigure(shift.startedAt, MaterialTheme.typography.displayLarge, mod, Formats::elapsed)
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Reading(stringResource(R.string.reading_distance), stringResource(R.string.reading_distance_note), distance) { mod ->
                        Row(mod, verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            BigFigure(f.distanceNumber(running.distanceM), MaterialTheme.typography.displayMedium, Modifier.weight(1f, fill = false))
                            Text(f.unitLabel, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 6.dp))
                        }
                    }
                    running.deductionSoFarCents?.let { cents ->
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        val money = f.money(cents)
                        Reading(
                            stringResource(if (state.settings.yourRate) R.string.reading_deduction_yours else R.string.reading_deduction),
                            stringResource(R.string.reading_deduction_note),
                            money,
                        ) { mod -> BigFigure(money, MaterialTheme.typography.headlineLarge, mod) }
                    }
                }
            }
        }
        item(key = "tracking") { TrackingCard(line, actions, confirm, closeTitle, closeText, closeLabel) }
        item(key = "sent") {
            IconLine(
                if (shift.serverId != null) Icons.CheckCircle else Icons.Info,
                stringResource(if (shift.serverId != null) R.string.running_on_server else R.string.running_on_phone),
            )
        }
        if (running.serverHasOtherShift) {
            item(key = "other") { NoticeCard(title = stringResource(R.string.running_other_shift), icon = Icons.Warning, tone = Tone.WARNING) }
        }
        state.banner?.takeIf { it.kind != BannerKind.ALL_SENT && it.kind != BannerKind.WAITING }?.let { b ->
            item(key = "banner") { SyncBannerCard(b, state.sending, actions::fix, actions::reminderShown) }
        }
    }
}

/** One instrument reading: a label over a large figure, with an optional note; read as one by TalkBack. */
@Composable
private fun Reading(label: String, note: String?, spoken: String? = null, figure: @Composable (Modifier) -> Unit) {
    Column(
        Modifier.fillMaxWidth().then(if (spoken != null) Modifier.clearAndSetSemantics { contentDescription = listOfNotNull(label, spoken, note).joinToString(", ") } else Modifier.semantics(mergeDescendants = true) {}),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.semantics { heading() })
        figure(Modifier.fillMaxWidth())
        if (note != null) Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** The tracker's state in words with its one fix; "not recording" also offers to end the shift at its last point. */
@Composable
private fun TrackingCard(line: TrackingLine, actions: HomeActions, confirm: ConfirmState, closeTitle: String, closeText: String, closeLabel: String) {
    val (title, detail) = Texts.tracking(line)
    val fix = line.fix
    NoticeCard(
        title = stringResource(title),
        body = stringResource(detail),
        icon = when {
            line.problem -> Icons.Warning
            else -> Icons.Location
        },
        tone = when {
            line == TrackingLine.NO_BACKGROUND -> Tone.WARNING
            line.problem -> Tone.PROBLEM
            else -> Tone.NEUTRAL
        },
        actionLabel = fix?.let { stringResource(Texts.fix(it)) },
        onAction = fix?.let { { actions.fix(it) } },
        secondaryLabel = if (line == TrackingLine.NOT_RECORDING) stringResource(R.string.close_unfinished) else null,
        onSecondary = if (line == TrackingLine.NOT_RECORDING) {
            { confirm.ask(ConfirmRequest(closeTitle, closeText, closeLabel, destructive = true, onConfirm = actions::closeUnfinished)) }
        } else {
            null
        },
    )
}
