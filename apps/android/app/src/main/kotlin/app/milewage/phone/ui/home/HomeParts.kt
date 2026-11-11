package app.milewage.phone.ui.home

import app.milewage.phone.ui.icons.Icons
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.milewage.core.shift.PeriodSummary
import app.milewage.core.sync.Reminder
import app.milewage.core.sync.StatusColor
import app.milewage.phone.R
import app.milewage.phone.ui.components.CardSurface
import app.milewage.phone.logic.Banner
import app.milewage.phone.logic.BannerKind
import app.milewage.phone.logic.Fix
import app.milewage.phone.logic.OdometerAsk
import app.milewage.phone.logic.SetupItem
import app.milewage.phone.logic.VehicleChoice
import app.milewage.phone.logic.VehicleSource
import app.milewage.phone.model.DisplaySettings
import app.milewage.phone.model.Formats
import app.milewage.phone.ui.Texts
import app.milewage.phone.ui.components.BigFigure
import app.milewage.phone.ui.components.NoticeCard
import app.milewage.phone.ui.components.FigureRow
import app.milewage.phone.ui.components.IconTile
import app.milewage.phone.ui.components.TileTone
import app.milewage.phone.ui.components.StatCell
import app.milewage.phone.ui.components.Tone
import app.milewage.phone.ui.theme.surfaces

/** Today, this week or this month: the distance large, then shifts and the deduction value (an estimate). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SummarySection(summary: PeriodSummary?, period: Period, settings: DisplaySettings, onPeriod: (Period) -> Unit) {
    val f = Formats(settings)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val labels = listOf(Period.DAY to R.string.period_today, Period.WEEK to R.string.period_week, Period.MONTH to R.string.period_month)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            labels.forEachIndexed { i, (p, label) ->
                SegmentedButton(
                    selected = p == period,
                    onClick = { onPeriod(p) },
                    shape = SegmentedButtonDefaults.itemShape(i, labels.size),
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(label), maxLines = 1) }
            }
        }
        val p = summary
        // One card: the distance large, then the shifts and the deduction under a hairline.
        CardSurface(Modifier.fillMaxWidth()) {
            Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    val label = stringResource(R.string.summary_distance)
                    val value = f.distance(p?.totalM)
                    Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    BigFigure(value, MaterialTheme.typography.displaySmall, Modifier.semantics { contentDescription = "$label, $value" })
                    if (p != null && p.unsent > 0) {
                        Text(
                            pluralStringResource(R.plurals.summary_unsent, p.unsent, p.unsent),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                IconTile(Icons.Route, tone = TileTone.Kind(1), size = 48.dp)
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            val shifts = stringResource(R.string.summary_shifts)
            val business = f.distance(p?.businessM) + " " + stringResource(R.string.summary_business).lowercase()
            val deduction = stringResource(if (settings.yourRate) R.string.summary_deduction_yours else R.string.summary_deduction)
            val estimate = stringResource(R.string.estimate)
            FigureRow(
                cells = listOf(
                    { m -> StatCell(shifts, p?.shifts?.toString() ?: "0", m, caption = business, icon = Icons.Shifts, tile = TileTone.Kind(0)) },
                    { m -> StatCell(deduction, f.money(p?.deductionCents), m, caption = estimate, icon = Icons.Savings, tile = TileTone.Kind(2)) },
                ),
            )
        }
        Text(
            stringResource(if (p?.deductionCents == null) R.string.summary_deduction_none else R.string.summary_deduction_caption),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The one sync notice (15 section 4.3, 4.4): all sent is one quiet line; anything waiting is a card
 * with the counts, the sentence, the reminder and one action.
 */
@Composable
fun SyncBannerCard(b: Banner, busy: Boolean, onFix: (Fix) -> Unit, onReminderShown: (Reminder.Level) -> Unit) {
    if (b.reminder != Reminder.Level.NONE) LaunchedEffect(b.reminder) { onReminderShown(b.reminder) }
    val statusLabel = stringResource(R.string.sync_status_label)
    if (b.kind == BannerKind.ALL_SENT && b.reminder == Reminder.Level.NONE) {
        Row(
            Modifier.fillMaxWidth().padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
            Text(stringResource(R.string.sync_all_sent), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    val counts = if (b.unsentShifts == 0) {
        stringResource(R.string.sync_all_sent)
    } else {
        stringResource(
            R.string.sync_not_yet,
            pluralStringResource(R.plurals.sync_unsent_shifts, b.unsentShifts, b.unsentShifts),
            pluralStringResource(R.plurals.sync_unsent_points, b.unsentFixes.toInt(), b.unsentFixes),
            b.oldestDays?.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.sync_oldest_days, it.toInt(), it) } ?: stringResource(R.string.sync_oldest_today),
        )
    }
    val sentence = Texts.banner(b.kind)?.let { stringResource(it) }
    val reminder = when (b.reminder) {
        Reminder.Level.NONE -> null
        Reminder.Level.NORMAL -> pluralStringResource(R.plurals.reminder_normal, b.unsentShifts, b.unsentShifts)
        Reminder.Level.STRONG -> pluralStringResource(R.plurals.reminder_strong, b.unsentShifts, b.unsentShifts, b.oldestDays ?: 0)
    }
    val progress = b.progress
    val fix = b.kind.fix
    NoticeCard(
        title = counts,
        modifier = Modifier.semantics { stateDescription = statusLabel },
        body = listOfNotNull(sentence, reminder).joinToString("\n").ifEmpty { null },
        icon = when (b.color) {
            StatusColor.RED -> Icons.Warning
            StatusColor.YELLOW -> Icons.Send
            StatusColor.GREEN -> Icons.Info
        },
        tone = when (b.color) {
            StatusColor.RED -> Tone.PROBLEM
            StatusColor.YELLOW -> Tone.WARNING
            StatusColor.GREEN -> Tone.NEUTRAL
        },
        actionLabel = fix?.let { stringResource(if (busy && it == Fix.SEND_NOW) R.string.sync_sending else Texts.fix(it)) },
        onAction = fix?.let { { if (!busy) onFix(it) } },
        extra = progress?.let { p ->
            {
                Text(
                    stringResource(R.string.sync_progress, p.fixesSent, p.fixesTotal.toInt(), minOf(p.shiftsDone + 1, p.shiftsTotal), p.shiftsTotal),
                    style = MaterialTheme.typography.bodyMedium,
                )
                val fraction = if (p.fixesTotal > 0) p.fixesSent.toFloat() / p.fixesTotal else 0f
                LinearProgressIndicator(progress = { fraction.coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
            }
        },
    )
}

/** "Finish setting up": what is left before the first shift, each step done or not from the phone's real state. */
@Composable
fun SetupCard(items: List<SetupItem>, onFix: (Fix) -> Unit) {
    val left = items.count { !it.done }
    if (left == 0) return
    CardSurface(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(vertical = 16.dp)) {
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stringResource(R.string.setup_title), style = MaterialTheme.typography.titleMedium)
                Text(
                    pluralStringResource(R.plurals.setup_left, left, left) + " " + stringResource(R.string.setup_progress, items.size - left, items.size),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                LinearProgressIndicator(progress = { (items.size - left).toFloat() / items.size }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp))
            }
            items.forEach { item ->
                val (title, detail) = Texts.setup(item.step)
                val state = stringResource(if (item.done) R.string.setup_done else R.string.setup_todo)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 56.dp)
                        .then(if (item.done) Modifier else Modifier.selectable(selected = false, role = Role.Button, onClick = { onFix(item.step.fix) }))
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                        .semantics(mergeDescendants = true) { stateDescription = state },
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        if (item.done) Icons.CheckCircle else Icons.Circle,
                        contentDescription = null,
                        tint = if (item.done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(title), style = MaterialTheme.typography.bodyLarge, color = if (item.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                        if (!item.done) Text(stringResource(detail), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (!item.done) Icon(Icons.ChevronRight, contentDescription = null)
                }
            }
        }
    }
}

/** The vehicle for the next shift: a choice when there are several, a line when one, and why when none. */
@Composable
fun NextShiftCard(v: VehicleChoice, unpaired: Boolean, onSelect: (Long) -> Unit, onFix: (Fix) -> Unit) {
    CardSurface(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                IconTile(Icons.Vehicles, tone = TileTone.Selected)
                Text(stringResource(R.string.next_shift), style = MaterialTheme.typography.titleMedium)
            }
            val muted = MaterialTheme.colorScheme.onSurfaceVariant
            when {
                unpaired -> Text(stringResource(R.string.not_paired_note), style = MaterialTheme.typography.bodyMedium, color = muted)
                v.vehicles.size > 1 -> {
                    Text(stringResource(R.string.vehicle), style = MaterialTheme.typography.labelLarge, color = muted)
                    FlowRow(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        v.vehicles.forEach { vehicle ->
                            FilterChip(
                                selected = vehicle.id == v.selectedId,
                                onClick = { onSelect(vehicle.id) },
                                label = { Text(vehicle.name) },
                                modifier = Modifier.heightIn(min = 48.dp),
                            )
                        }
                    }
                }
                v.vehicles.size == 1 -> Text(stringResource(R.string.vehicle_one, v.vehicles[0].name), style = MaterialTheme.typography.bodyLarge)
                v.source == VehicleSource.LOADING -> Text(stringResource(R.string.vehicles_loading), style = MaterialTheme.typography.bodyMedium, color = muted)
                else -> {
                    Text(
                        stringResource(if (v.source == VehicleSource.SERVER) R.string.vehicles_none else R.string.vehicles_not_loaded),
                        style = MaterialTheme.typography.bodyMedium,
                        color = muted,
                    )
                    OutlinedButton(onClick = { onFix(Fix.RETRY_VEHICLES) }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.try_again)) }
                }
            }
            if (v.source == VehicleSource.KEPT && v.vehicles.isNotEmpty()) {
                Text(stringResource(R.string.vehicles_kept), style = MaterialTheme.typography.bodyMedium, color = muted)
            }
        }
    }
}

/**
 * The odometer check (Comma's cadence, about twice a month): before a shift, its start reading
 * ("Save and start", or "Start without it"); after a shift, its end reading ("Save reading", "Not now").
 */
@Composable
fun OdometerDialog(ask: OdometerAsk, unitLabel: String, onSave: (String) -> Unit, onSkip: () -> Unit, onDismiss: () -> Unit) {
    var text by rememberSaveable(ask) { mutableStateOf("") }
    val atStart = ask is OdometerAsk.AtStart
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.surfaces.popover,
        title = { Text(stringResource(R.string.odometer_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(if (atStart) R.string.odometer_start_text else R.string.odometer_end_text))
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    label = { Text(stringResource(R.string.odometer_field)) },
                    placeholder = { Text(stringResource(R.string.odometer_hint, unitLabel)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(enabled = text.isNotBlank(), onClick = { onSave(text) }) {
                Text(stringResource(if (atStart) R.string.odometer_start_save else R.string.odometer_save))
            }
        },
        dismissButton = {
            TextButton(onClick = if (atStart) onSkip else onDismiss) {
                Text(stringResource(if (atStart) R.string.odometer_skip else R.string.not_now))
            }
        },
    )
}

/** A line of muted text with an icon, read as one by TalkBack. */
@Composable
fun IconLine(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = text },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
