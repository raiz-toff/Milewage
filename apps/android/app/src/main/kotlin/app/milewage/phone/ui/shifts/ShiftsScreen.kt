package app.milewage.phone.ui.shifts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.milewage.core.shift.CalcSource
import app.milewage.core.sync.ShiftMarker
import app.milewage.phone.R
import app.milewage.phone.logic.ShiftGroup
import app.milewage.phone.logic.ShiftRow
import app.milewage.phone.logic.WeekTitle
import app.milewage.phone.model.Formats
import app.milewage.phone.ui.Texts
import app.milewage.phone.ui.ViewModels
import app.milewage.phone.ui.components.EmptyState
import app.milewage.phone.ui.components.ListRow
import app.milewage.phone.ui.components.LocalSnackbars
import app.milewage.phone.ui.components.RowDivider
import app.milewage.phone.ui.components.Rows
import app.milewage.phone.ui.components.Screen
import app.milewage.phone.ui.components.tabular

@Composable
fun ShiftsRoute(onOpenShift: (String) -> Unit, onGoHome: () -> Unit, vm: ShiftsViewModel = viewModel(factory = ViewModels.shifts())) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbars = LocalSnackbars.current
    val res = LocalResources.current
    LaunchedEffect(vm) {
        vm.event.collect { e ->
            when (e) {
                ShiftsEvent.StillWaiting -> snackbars.show(res.getString(R.string.sync_still_waiting))
            }
        }
    }
    ShiftsContent(state, onOpenShift, onGoHome, vm::refresh, vm::showOlder)
}

/** The shifts list, a thin renderer of [ShiftsState]. Pull down to send to the server. */
@Composable
fun ShiftsContent(state: ShiftsState, onOpenShift: (String) -> Unit, onGoHome: () -> Unit, onRefresh: () -> Unit, onShowOlder: () -> Unit) {
    val f = Formats(state.settings)
    Screen(title = stringResource(R.string.nav_shifts), onRefresh = onRefresh, refreshing = state.refreshing) {
        if (state.loaded && state.groups.isEmpty()) {
            item(key = "empty") {
                EmptyState(
                    icon = Icons.AutoMirrored.Filled.List,
                    title = stringResource(R.string.shifts_empty_title),
                    body = stringResource(R.string.shifts_empty_body),
                    actionLabel = stringResource(R.string.shifts_go_home),
                    onAction = onGoHome,
                )
            }
        }
        state.groups.forEach { g -> item(key = g.start.toString()) { WeekGroup(g, f, onOpenShift) } }
        if (state.hasMore) {
            item(key = "older") {
                OutlinedButton(onClick = onShowOlder, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(stringResource(R.string.shifts_older)) }
            }
        }
    }
}

@Composable
private fun WeekGroup(g: ShiftGroup, f: Formats, onOpenShift: (String) -> Unit) {
    val title = when (val t = g.title) {
        WeekTitle.ThisWeek -> stringResource(R.string.week_this)
        WeekTitle.LastWeek -> stringResource(R.string.week_last)
        is WeekTitle.WeekOf -> stringResource(R.string.week_of, f.day(t.start))
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.weight(1f))
            Text(
                pluralStringResource(R.plurals.week_total, g.shifts, g.shifts, f.distance(g.totalM)),
                style = MaterialTheme.typography.bodyMedium.tabular(),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Rows {
            g.rows.forEachIndexed { i, row ->
                if (i > 0) RowDivider()
                ShiftListRow(row, f) { onOpenShift(row.clientId) }
            }
        }
    }
}

private fun markerIcon(m: ShiftMarker): ImageVector = when (m) {
    ShiftMarker.SENT -> Icons.Filled.CheckCircle
    ShiftMarker.NEEDS_ATTENTION, ShiftMarker.SENT_DIFFERS -> Icons.Filled.Warning
    ShiftMarker.ON_PHONE_ONLY, ShiftMarker.SENDING -> Icons.Filled.Info
}

/** One shift: day and times, distance, who calculated it, its send state in words, and what to check. */
@Composable
fun ShiftListRow(row: ShiftRow, f: Formats, onClick: () -> Unit) {
    val day = f.shortDay(row.day)
    val times = f.range(row.startedAt, row.endedAt)
    val distance = if (row.running) stringResource(R.string.shift_in_progress) else f.distance(row.totalM)
    val calc = when {
        row.running -> stringResource(R.string.shift_in_progress)
        row.totalM == null -> stringResource(R.string.calc_waiting)
        row.calcSource == CalcSource.SERVER -> stringResource(R.string.calc_server)
        else -> stringResource(R.string.calc_phone)
    }
    val marker = stringResource(Texts.marker(row.marker))
    val review = if (row.review > 0) pluralStringResource(R.plurals.shift_review, row.review, row.review) else null
    val supporting = listOfNotNull(calc, marker, row.vehicle).joinToString(" · ")
    val label = stringResource(R.string.shift_row_label, day, times, distance, listOfNotNull(supporting, review).joinToString(", "))
    ListRow(
        headline = "$day · $times",
        supporting = if (review != null) "$supporting\n$review" else supporting,
        leading = {
            Icon(
                if (row.running) Icons.Filled.LocationOn else markerIcon(row.marker),
                contentDescription = null,
                tint = when {
                    row.running -> MaterialTheme.colorScheme.primary
                    row.marker == ShiftMarker.NEEDS_ATTENTION -> MaterialTheme.colorScheme.error
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier.size(24.dp),
            )
        },
        trailing = { Text(distance, style = MaterialTheme.typography.titleMedium.tabular()) },
        onClick = onClick,
        modifier = Modifier.clearAndSetSemantics {
            contentDescription = label
            role = Role.Button
            onClick { onClick(); true }
        },
    )
}
