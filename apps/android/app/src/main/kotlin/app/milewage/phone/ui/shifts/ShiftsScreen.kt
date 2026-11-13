package app.milewage.phone.ui.shifts

import app.milewage.phone.ui.icons.Icons
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import app.milewage.phone.ui.theme.surfaces
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import app.milewage.phone.ui.components.IconTile
import app.milewage.phone.ui.components.TileTone
import app.milewage.phone.ui.components.ListRow
import app.milewage.phone.ui.components.LocalSnackbars
import app.milewage.phone.ui.components.RowDivider
import app.milewage.phone.ui.components.Rows
import app.milewage.phone.ui.components.Screen
import app.milewage.phone.ui.components.animatedItem
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
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ShiftsContent(state: ShiftsState, onOpenShift: (String) -> Unit, onGoHome: () -> Unit, onRefresh: () -> Unit, onShowOlder: () -> Unit) {
    val f = Formats(state.settings)
    // The vehicle earns a place on each row only when there is more than one to tell apart.
    val showVehicle = state.groups.flatMap { g -> g.rows.mapNotNull { it.vehicle } }.distinct().size > 1
    val shown = state.groups.sumOf { it.rows.size }
    Screen(title = stringResource(R.string.nav_shifts), onRefresh = onRefresh, refreshing = state.refreshing, spacing = 0.dp) {
        if (state.loaded && state.groups.isEmpty()) {
            item(key = "empty") {
                EmptyState(
                    icon = Icons.Shifts,
                    title = stringResource(R.string.shifts_empty_title),
                    body = stringResource(R.string.shifts_empty_body),
                    actionLabel = stringResource(R.string.shifts_go_home),
                    onAction = onGoHome,
                )
            }
        }
        state.groups.forEach { g ->
            // The week's name and total stay at the top while its shifts scroll under them.
            stickyHeader(key = "head-${g.start}") { WeekHeader(g, f) }
            animatedItem(key = g.start.toString()) {
                Rows(Modifier.padding(bottom = 16.dp)) {
                    g.rows.forEachIndexed { i, row ->
                        if (i > 0) RowDivider()
                        ShiftListRow(row, f, showVehicle) { onOpenShift(row.clientId) }
                    }
                }
            }
        }
        if (state.hasMore) {
            // Reaching the end loads the next page; a quiet line says so while it comes.
            item(key = "older") {
                LaunchedEffect(shown) { onShowOlder() }
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Text(stringResource(R.string.shifts_loading_older), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/** A week's name and its total, on the page's colour so the shifts scroll under it when it sticks. */
@Composable
private fun WeekHeader(g: ShiftGroup, f: Formats) {
    val title = when (val t = g.title) {
        WeekTitle.ThisWeek -> stringResource(R.string.week_this)
        WeekTitle.LastWeek -> stringResource(R.string.week_last)
        is WeekTitle.WeekOf -> stringResource(R.string.week_of, f.day(t.start))
    }
    Row(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.surfaces.page)
            .padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 8.dp)
            .semantics { heading() },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.weight(1f))
        Text(
            pluralStringResource(R.plurals.week_total, g.shifts, g.shifts, f.distance(g.totalM)),
            style = MaterialTheme.typography.bodyMedium.tabular(),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * One shift: day and times, and the distance. A second line only when something differs from a
 * finished shift on the server (not sent yet, totals waiting, needs attention, flags to check), and
 * the vehicle when the driver has more than one ([showVehicle]). TalkBack always reads it all.
 */
@Composable
fun ShiftListRow(row: ShiftRow, f: Formats, showVehicle: Boolean = true, onClick: () -> Unit) {
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
    // TalkBack reads everything; the eye gets only what differs from a finished shift on the server.
    val full = listOfNotNull(calc, marker, row.vehicle).joinToString(" · ")
    val label = stringResource(R.string.shift_row_label, day, times, distance, listOfNotNull(full, review).joinToString(", "))
    val exception = when {
        row.running -> null
        row.totalM == null -> calc
        row.marker != ShiftMarker.SENT -> marker
        else -> null
    }
    val seen = listOfNotNull(exception, row.vehicle.takeIf { showVehicle }).joinToString(" · ").ifEmpty { null }
    ListRow(
        headline = "$day · $times",
        supporting = listOfNotNull(seen, review).joinToString("\n").ifEmpty { null },
        leading = {
            // The picture says what the row is; the send state stays in the words under the day.
            when {
                row.running -> IconTile(Icons.Location, tone = TileTone.Selected)
                row.marker == ShiftMarker.NEEDS_ATTENTION || row.marker == ShiftMarker.SENT_DIFFERS -> IconTile(Icons.Warning, tone = TileTone.Problem)
                else -> IconTile(Icons.Route)
            }
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
