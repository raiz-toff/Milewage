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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.graphics.graphicsLayer
import app.milewage.phone.ui.theme.Motion
import app.milewage.phone.ui.theme.surfaces
import app.milewage.phone.ui.components.DemoMark
import app.milewage.phone.ui.components.animatedItem
import app.milewage.phone.ui.theme.fadeThrough
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.sync.Reminder
import app.milewage.data.RunningShiftView
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
    // Starting or ending a shift fades through from one Home to the other. The key is "is a shift
    // running", so the running screen updates in place as its figures change.
    AnimatedContent(targetState = state.running, contentKey = { it != null }, transitionSpec = { fadeThrough() }, label = "home") { running ->
        if (running != null) {
            RunningShiftContent(state, running, actions, confirm)
        } else {
            IdleContent(state, actions)
        }
    }
    state.odometer?.let { ask ->
        OdometerDialog(ask, Formats(state.settings).unitLabel, actions::saveOdometer, actions::skipOdometer, actions::dismissOdometer)
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
        onRefresh = actions::refresh,
        refreshing = state.refreshing,
        bottomBar = {
            if (state.ready) {
                BottomAction {
                    val starting = state.busy == Busy.START
                    val haptics = LocalHapticFeedback.current
                    // The one brand action: lane yellow (primaryContainer), 64 dp, easy to hit in a mount.
                    // A confirm tap, so a driver feels it start without looking.
                    BrandButton(
                        text = stringResource(if (starting) R.string.starting_shift else R.string.start_shift),
                        onClick = {
                            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                            actions.start()
                        },
                        icon = Icons.Play,
                        busy = starting,
                        size = BrandSize.VEHICLE,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        },
    ) {
        if (state.demo) animatedItem(key = "demo") { DemoMark() }
        if (state.ready && state.setup.any { !it.done }) animatedItem(key = "setup") { SetupCard(state.setup, actions::fix) }
        animatedItem(key = "summary") {
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
        // Home speaks up only when something waits; "everything is on the server" lives in Settings > Sending.
        state.banner?.takeIf { it.kind != BannerKind.ALL_SENT || it.reminder != Reminder.Level.NONE }?.let { b -> animatedItem(key = "banner") { SyncBannerCard(b, state.sending, actions::fix, actions::reminderShown) } }
        if (!state.otherServer.none) {
            animatedItem(key = "other-server") { OtherServerCard(state.otherServer, actions::connectOtherServer, actions::deleteOtherServer) }
        }
        animatedItem(key = "next") {
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
        bottomBar = {
            BottomAction {
                val ending = state.busy == Busy.END
                val haptics = LocalHapticFeedback.current
                Button(
                    onClick = {
                        val end = {
                            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                            actions.end()
                        }
                        confirm.ask(ConfirmRequest(endTitle, endText, endLabel, destructive = true, dismissLabel = keep, onConfirm = end))
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
        val live = line == TrackingLine.RECORDING || line == TrackingLine.SAVING_BATTERY || line == TrackingLine.NO_BACKGROUND
        if (state.demo) animatedItem(key = "demo") { DemoMark() }
        if (live) animatedItem(key = "live") { LiveChip() }
        animatedItem(key = "readings") {
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
        animatedItem(key = "tracking") { TrackingCard(line, actions, confirm, closeTitle, closeText, closeLabel) }
        animatedItem(key = "sent") {
            IconLine(
                if (shift.serverId != null) Icons.CheckCircle else Icons.Info,
                stringResource(if (shift.serverId != null) R.string.running_on_server else R.string.running_on_phone),
            )
        }
        if (running.serverHasOtherShift) {
            animatedItem(key = "other") { NoticeCard(title = stringResource(R.string.running_other_shift), icon = Icons.Warning, tone = Tone.WARNING) }
        }
        state.banner?.takeIf { it.kind != BannerKind.ALL_SENT && it.kind != BannerKind.WAITING }?.let { b ->
            animatedItem(key = "banner") { SyncBannerCard(b, state.sending, actions::fix, actions::reminderShown) }
        }
    }
}

/**
 * "Recording" with a dot that breathes while the phone records, like a camera's: says the shift is
 * live without a progress bar that reads as loading. The dot stands still when nothing ticks (tests,
 * screenshots) and Android's "Remove animations" stops the breathing.
 */
@Composable
private fun LiveChip() {
    val ticking = LocalTicking.current
    val alpha = if (ticking) {
        val pulse = rememberInfiniteTransition(label = "live")
        pulse.animateFloat(
            initialValue = 1f,
            targetValue = 0.3f,
            animationSpec = infiniteRepeatable(tween(900, easing = Motion.Standard), RepeatMode.Reverse),
            label = "dot",
        ).value
    } else {
        1f
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
        Row(
            Modifier
                .background(MaterialTheme.surfaces.card, CircleShape)
                .padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(8.dp).graphicsLayer { this.alpha = alpha }.background(MaterialTheme.colorScheme.error, CircleShape))
            Text(stringResource(R.string.running_live), style = MaterialTheme.typography.labelLarge)
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
