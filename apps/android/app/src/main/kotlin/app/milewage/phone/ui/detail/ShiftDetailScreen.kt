package app.milewage.phone.ui.detail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.milewage.core.api.TripKind
import app.milewage.core.shift.CalcSource
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.TripRecord
import app.milewage.core.shift.TripSource
import app.milewage.core.sync.ShiftMarker
import app.milewage.data.ShiftDetail
import app.milewage.phone.R
import app.milewage.phone.logic.OverwriteText
import app.milewage.phone.logic.TripChoice
import app.milewage.phone.model.Formats
import app.milewage.phone.ui.Texts
import app.milewage.phone.ui.ViewModels
import app.milewage.phone.ui.components.BigFigure
import app.milewage.phone.ui.components.EmptyState
import app.milewage.phone.ui.components.ListRow
import app.milewage.phone.ui.components.LocalSnackbars
import app.milewage.phone.ui.components.NoticeCard
import app.milewage.phone.ui.components.RowDivider
import app.milewage.phone.ui.components.Rows
import app.milewage.phone.ui.components.Screen
import app.milewage.phone.ui.components.SectionLabel
import app.milewage.phone.ui.components.StatTile
import app.milewage.phone.ui.components.Tone
import app.milewage.phone.ui.components.tabular
import kotlinx.datetime.LocalDate

/** What the detail screen's buttons do. */
interface DetailActions {
    fun editTrip(trip: TripRecord, choice: TripChoice, purpose: String)

    fun addTrip(distance: String, choice: TripChoice, purpose: String)

    fun setOdometer(kind: OdometerKind, text: String)

    fun setNotes(text: String)

    fun dismissOverwrite(id: Long)

    fun sendNow()
}

@Composable
fun ShiftDetailRoute(clientId: String, onBack: () -> Unit, vm: ShiftDetailViewModel = viewModel(key = clientId, factory = ViewModels.detail(clientId))) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbars = LocalSnackbars.current
    val res = LocalResources.current
    LaunchedEffect(vm) {
        vm.event.collect { e ->
            val unit = Formats(vm.state.value.settings).unitLabel
            val text = when (e) {
                is DetailEvent.Saved -> res.getString(
                    when (e.what) {
                        EditWhat.TRIP_CHANGED -> R.string.trip_changed
                        EditWhat.TRIP_ADDED -> R.string.trip_added_saved
                        EditWhat.ODOMETER -> R.string.odometer_saved
                        EditWhat.NOTES -> R.string.notes_saved
                    },
                )
                is DetailEvent.Refused -> res.getString(Texts.edit(e.outcome) ?: R.string.edit_failed)
                DetailEvent.DistanceInvalid -> res.getString(R.string.distance_invalid, unit)
                DetailEvent.OdometerInvalid -> res.getString(R.string.odometer_invalid, unit)
                DetailEvent.PurposeInvalid -> res.getString(R.string.trip_purpose_invalid)
                DetailEvent.StillWaiting -> res.getString(R.string.sync_still_waiting)
            }
            snackbars.show(text)
        }
    }
    val actions = remember(vm) {
        object : DetailActions {
            override fun editTrip(trip: TripRecord, choice: TripChoice, purpose: String) = vm.editTrip(trip, choice, purpose)

            override fun addTrip(distance: String, choice: TripChoice, purpose: String) = vm.addTrip(distance, choice, purpose)

            override fun setOdometer(kind: OdometerKind, text: String) = vm.setOdometer(kind, text)

            override fun setNotes(text: String) = vm.setNotes(text)

            override fun dismissOverwrite(id: Long) = vm.dismissOverwrite(id)

            override fun sendNow() = vm.sendNow()
        }
    }
    DetailContent(state, actions, onBack)
}

/** One shift, a thin renderer of [DetailState]. No connection needed: it reads the phone's database. */
@Composable
fun DetailContent(state: DetailState, actions: DetailActions, onBack: () -> Unit) {
    val f = Formats(state.settings)
    val d = state.detail
    if (d == null) {
        Screen(title = stringResource(R.string.shift_title), onBack = onBack) {
            if (state.loaded) {
                item {
                    EmptyState(
                        title = stringResource(R.string.shift_gone_title),
                        body = stringResource(R.string.shift_gone_body),
                        actionLabel = stringResource(R.string.back_to_shifts),
                        onAction = onBack,
                    )
                }
            }
        }
        return
    }
    val s = d.shift
    var editing by remember { mutableStateOf<TripRecord?>(null) }
    var adding by rememberSaveable { mutableStateOf(false) }
    var odometer by rememberSaveable { mutableStateOf<OdometerKind?>(null) }
    val times = f.range(s.startedAt, s.endedAt) + " · " + f.duration(s.startedAt, s.endedAt)
    Screen(
        title = f.longDay(LocalDate.parse(s.localDate)),
        subtitle = listOfNotNull(times, d.vehicle?.name).joinToString(" · "),
        onBack = onBack,
    ) {
        state.overwrites.forEach { o -> item(key = "ow${o.id}") { OverwriteNotice(o, f, actions) } }
        item(key = "totals") { Totals(state, d, f) }
        item(key = "route") { RouteCard(d) }
        item(key = "send") { SendState(d.marker, state.sending, actions) }
        val review = state.flags.filter { it.review }
        val info = state.flags.filter { !it.review }
        if (review.isNotEmpty()) {
            item(key = "review") {
                NoticeCard(
                    title = stringResource(R.string.checks_title),
                    body = review.map { stringResource(Texts.flag(it)) }.joinToString("\n\n"),
                    icon = Icons.Filled.Warning,
                    tone = Tone.WARNING,
                )
            }
        }
        if (info.isNotEmpty() || d.interruptions.isNotEmpty()) {
            item(key = "info") {
                val lines = info.map { stringResource(Texts.flag(it)) } +
                    listOfNotNull(d.interruptions.size.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.interruptions_count, it, it) })
                NoticeCard(title = stringResource(R.string.checks_info), body = lines.joinToString("\n\n"), icon = Icons.Filled.Info)
            }
        }
        item(key = "trips") { Trips(state, d, f, onEdit = { editing = it }, onAdd = { adding = true }) }
        if (state.estimated) item(key = "stops") { Stops(d, f) }
        item(key = "odometer") { Odometer(d, f, state.editable) { odometer = it } }
        item(key = "notes") { Notes(s.notes ?: "", state.editable, actions::setNotes) }
    }
    editing?.let { t ->
        TripDialog(
            title = stringResource(R.string.trip_edit_title, f.clock(t.startedAt)),
            choices = TripChoice.offered(state.estimated),
            initial = TripChoice.of(t.kind, state.estimated),
            initialPurpose = t.purpose,
            distanceUnit = null,
            onSave = { choice, purpose, _ ->
                actions.editTrip(t, choice, purpose)
                editing = null
            },
            onDismiss = { editing = null },
        )
    }
    if (adding) {
        TripDialog(
            title = stringResource(R.string.add_trip),
            choices = TripChoice.offered(false),
            initial = TripChoice.BUSINESS,
            initialPurpose = "",
            distanceUnit = f.unitLabel,
            onSave = { choice, purpose, distance ->
                actions.addTrip(distance, choice, purpose)
                adding = false
            },
            onDismiss = { adding = false },
        )
    }
    odometer?.let { kind ->
        OdometerEditDialog(kind, f.unitLabel, onSave = {
            actions.setOdometer(kind, it)
            odometer = null
        }, onDismiss = { odometer = null })
    }
}

@Composable
private fun OverwriteNotice(o: OverwriteText, f: Formats, actions: DetailActions) {
    val text = when (o) {
        is OverwriteText.Difference -> stringResource(R.string.overwrite_difference, f.distance(o.serverM), f.distance(o.phoneM), f.distance(o.diffM)) +
            (if (o.reasons.isNotEmpty()) " " + stringResource(R.string.overwrite_reasons, o.reasons.joinToString(", ")) else "")
        is OverwriteText.Deleted -> stringResource(R.string.overwrite_deleted)
        is OverwriteText.EditNotApplied -> stringResource(R.string.overwrite_not_applied)
        is OverwriteText.Replaced -> stringResource(R.string.overwrite_replaced)
    }
    NoticeCard(
        title = text,
        icon = Icons.Filled.Info,
        tone = Tone.WARNING,
        actionLabel = stringResource(R.string.dismiss),
        onAction = { actions.dismissOverwrite(o.id) },
    )
}

@Composable
private fun Totals(state: DetailState, d: ShiftDetail, f: Formats) {
    val s = d.shift
    val dist = s.distances
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(stringResource(R.string.total_distance), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                BigFigure(if (s.running) stringResource(R.string.shift_in_progress) else f.distance(dist?.totalM), MaterialTheme.typography.displaySmall)
                Text(
                    when {
                        s.running -> stringResource(R.string.shift_in_progress)
                        dist == null -> stringResource(R.string.calc_waiting)
                        s.calcSource == CalcSource.SERVER -> stringResource(R.string.calc_server)
                        else -> stringResource(R.string.calc_phone)
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (state.estimated && dist != null) {
                    Text(
                        stringResource(R.string.split_estimated, f.distance(dist.activeM), f.distance(dist.deadheadM)),
                        style = MaterialTheme.typography.bodyMedium.tabular(),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatTile(stringResource(R.string.business_distance), f.distance(dist?.businessM), Modifier.weight(1f))
            StatTile(stringResource(R.string.shift_time), f.duration(s.startedAt, s.endedAt), Modifier.weight(1f))
        }
        if (s.serverDeductionKnown && s.serverDeductionCents != null) {
            StatTile(stringResource(R.string.deduction), f.money(s.serverDeductionCents), Modifier.fillMaxWidth(), caption = stringResource(R.string.calc_server))
        }
    }
}

@Composable
private fun RouteCard(d: ShiftDetail) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.route), style = MaterialTheme.typography.titleMedium)
            if (d.route.size >= 2) {
                RouteSketch(d.route, d.stops)
            } else {
                Text(stringResource(R.string.route_none), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun SendState(marker: ShiftMarker, sending: Boolean, actions: DetailActions) {
    val words = stringResource(Texts.marker(marker))
    if (marker == ShiftMarker.SENT) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(words, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    NoticeCard(
        title = words,
        body = stringResource(
            when (marker) {
                ShiftMarker.NEEDS_ATTENTION -> R.string.sync_needs_attention
                ShiftMarker.SENT_DIFFERS -> R.string.flag_calc_mismatch
                else -> R.string.sync_waiting
            },
        ),
        icon = if (marker == ShiftMarker.NEEDS_ATTENTION || marker == ShiftMarker.SENT_DIFFERS) Icons.Filled.Warning else Icons.Filled.Info,
        tone = if (marker == ShiftMarker.NEEDS_ATTENTION) Tone.PROBLEM else Tone.NEUTRAL,
        actionLabel = if (marker == ShiftMarker.SENT_DIFFERS) null else stringResource(if (sending) R.string.sync_sending else R.string.fix_send_now),
        onAction = if (marker == ShiftMarker.SENT_DIFFERS) null else ({ actions.sendNow() }),
    )
}

private fun kindWord(t: TripRecord, estimated: Boolean): Int? = when {
    t.kind == TripKind.PERSONAL -> R.string.kind_personal
    estimated && t.kind == TripKind.ACTIVE -> R.string.kind_active_short
    estimated && t.kind == TripKind.DEADHEAD -> R.string.kind_deadhead_short
    else -> R.string.kind_business
}

@Composable
private fun Trips(state: DetailState, d: ShiftDetail, f: Formats, onEdit: (TripRecord) -> Unit, onAdd: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Rows(label = stringResource(R.string.trips_title)) {
            if (d.trips.isEmpty()) ListRow(headline = stringResource(R.string.trips_none))
            d.trips.forEachIndexed { i, t ->
                if (i > 0) RowDivider()
                val marks = listOfNotNull(
                    kindWord(t, state.estimated)?.let { stringResource(it) },
                    t.purpose.takeIf { it.isNotBlank() },
                    if (state.estimated && t.source == TripSource.AUTO) stringResource(R.string.trip_estimated) else null,
                    if (t.source == TripSource.MANUAL) stringResource(R.string.trip_added) else null,
                )
                ListRow(
                    headline = f.range(t.startedAt, t.endedAt) + " · " + f.distance(t.distanceM),
                    supporting = marks.joinToString(" · "),
                    trailing = if (state.editable) {
                        {
                            val change = stringResource(R.string.trip_change_label, f.clock(t.startedAt))
                            TextButton(onClick = { onEdit(t) }, modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = change }) {
                                Text(stringResource(R.string.trip_change))
                            }
                        }
                    } else {
                        null
                    },
                )
            }
        }
        if (state.editable) {
            OutlinedButton(onClick = onAdd, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Icon(Icons.Filled.Add, contentDescription = null)
                Text(stringResource(R.string.add_trip), modifier = Modifier.padding(start = 8.dp))
            }
        }
    }
}

@Composable
private fun Stops(d: ShiftDetail, f: Formats) {
    Rows(label = stringResource(R.string.stops_title)) {
        if (d.stops.isEmpty()) ListRow(headline = stringResource(R.string.stops_none))
        d.stops.forEachIndexed { i, st ->
            if (i > 0) RowDivider()
            val role = st.estRole.takeIf { it != "none" }?.let { stringResource(R.string.stop_role, it) }
            ListRow(
                headline = stringResource(R.string.stop_line, f.clock(st.startedAt), ((st.dwellS + 30) / 60).toInt(), st.confidence),
                supporting = role,
            )
        }
    }
}

@Composable
private fun Odometer(d: ShiftDetail, f: Formats, editable: Boolean, onEdit: (OdometerKind) -> Unit) {
    Rows(label = stringResource(R.string.odometer_section)) {
        listOf(OdometerKind.SHIFT_START to R.string.odometer_start, OdometerKind.SHIFT_END to R.string.odometer_end).forEachIndexed { i, (kind, label) ->
            if (i > 0) RowDivider()
            val reading = d.odometer.firstOrNull { it.kind == kind }
            ListRow(
                headline = stringResource(label),
                supporting = reading?.let { f.odometer(it.readingM) } ?: stringResource(R.string.odometer_none),
                trailing = if (editable) {
                    { TextButton(onClick = { onEdit(kind) }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.odometer_edit)) } }
                } else {
                    null
                },
            )
        }
    }
}

@Composable
private fun Notes(current: String, editable: Boolean, onSave: (String) -> Unit) {
    var text by rememberSaveable(current) { mutableStateOf(current) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel(stringResource(R.string.notes_title))
        if (editable) {
            OutlinedTextField(
                value = text,
                onValueChange = { if (it.length <= 1000) text = it },
                placeholder = { Text(stringResource(R.string.notes_hint)) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
            )
            OutlinedButton(onClick = { onSave(text) }, enabled = text.trim() != current.trim(), modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.save))
            }
        } else {
            Text(current.ifBlank { "—" }, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(horizontal = 16.dp))
        }
    }
}

/** Change a trip's purpose (business or personal, its description), or add one with its distance. */
@Composable
private fun TripDialog(
    title: String,
    choices: List<TripChoice>,
    initial: TripChoice,
    initialPurpose: String,
    /** Non-null: adding a trip, with a distance field in this unit. */
    distanceUnit: String?,
    onSave: (TripChoice, String, String) -> Unit,
    onDismiss: () -> Unit,
) {
    var choice by rememberSaveable { mutableStateOf(initial) }
    var purpose by rememberSaveable { mutableStateOf(initialPurpose) }
    var distance by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (distanceUnit != null) {
                    Text(stringResource(R.string.add_trip_text), style = MaterialTheme.typography.bodyMedium)
                    OutlinedTextField(
                        value = distance,
                        onValueChange = { distance = it },
                        label = { Text(stringResource(R.string.add_trip_distance, distanceUnit)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Column(Modifier.selectableGroup()) {
                    choices.forEach { c ->
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = c == choice, role = Role.RadioButton, onClick = { choice = c }),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = c == choice, onClick = null)
                            Text(stringResource(Texts.choice(c)), modifier = Modifier.padding(start = 12.dp))
                        }
                    }
                }
                OutlinedTextField(
                    value = purpose,
                    onValueChange = { if (it.length <= 200) purpose = it },
                    label = { Text(stringResource(R.string.trip_purpose)) },
                    placeholder = { Text(stringResource(R.string.trip_purpose_hint)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = if (distanceUnit != null) distance.isNotBlank() else purpose.isNotBlank(),
                onClick = { onSave(choice, purpose, distance) },
            ) { Text(stringResource(R.string.save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
private fun OdometerEditDialog(kind: OdometerKind, unit: String, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (kind == OdometerKind.SHIFT_START) R.string.odometer_start else R.string.odometer_end)) },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                label = { Text(stringResource(R.string.odometer_field)) },
                placeholder = { Text(stringResource(R.string.odometer_hint, unit)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = { TextButton(enabled = text.isNotBlank(), onClick = { onSave(text) }) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}
