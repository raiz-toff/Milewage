package app.milewage.phone.ui.diagnostics

import app.milewage.phone.ui.icons.Icons
import android.content.ClipData
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import app.milewage.core.connect.Where
import app.milewage.core.pairing.PairingStatus
import app.milewage.phone.R
import app.milewage.phone.logic.DiagnosticsInfo
import app.milewage.phone.logic.DiagnosticsReport
import app.milewage.phone.logic.DiagnosticsSource
import app.milewage.phone.ui.ViewModels
import app.milewage.phone.ui.components.ListRow
import app.milewage.phone.ui.components.LocalSnackbars
import app.milewage.phone.ui.components.NoticeCard
import app.milewage.phone.ui.components.RowDivider
import app.milewage.phone.ui.components.Rows
import app.milewage.phone.ui.components.Screen
import app.milewage.phone.ui.components.Tone
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class DiagnosticsState(
    /** Null while the maths check runs. */
    val selfCheck: List<String>? = null,
    val info: DiagnosticsInfo? = null,
) {
    val summary: String? get() = info?.let { DiagnosticsReport.text(it, selfCheck) }
}

/** The mileage maths check (`Engine.selfCheck()`) and the phone's states, for a bug report. */
class DiagnosticsViewModel(private val source: DiagnosticsSource) : ViewModel() {
    private val _state = MutableStateFlow(DiagnosticsState())
    val state: StateFlow<DiagnosticsState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            val check = withContext(Dispatchers.Default) { runCatching { source.selfCheck() }.getOrElse { listOf("self check threw ${it::class.simpleName}") } }
            val info = runCatching { source.snapshot() }.getOrNull()
            _state.value = DiagnosticsState(check, info)
        }
    }
}

@Composable
fun DiagnosticsRoute(onBack: () -> Unit, vm: DiagnosticsViewModel = viewModel(factory = ViewModels.diagnostics())) {
    val state by vm.state.collectAsStateWithLifecycle()
    val clipboard = LocalClipboard.current
    val snackbars = LocalSnackbars.current
    val scope = rememberCoroutineScope()
    val copied = stringResource(R.string.diag_copied)
    DiagnosticsContent(state, onBack) { text ->
        scope.launch {
            clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("MileWage diagnostics", text)))
            snackbars.show(copied)
        }
    }
}

@Composable
fun DiagnosticsContent(state: DiagnosticsState, onBack: () -> Unit, onCopy: (String) -> Unit) {
    Screen(title = stringResource(R.string.diag_title), onBack = onBack) {
        item(key = "maths") {
            val check = state.selfCheck
            NoticeCard(
                title = stringResource(R.string.diag_maths),
                body = when {
                    check == null -> stringResource(R.string.diag_running)
                    check.isEmpty() -> stringResource(R.string.diag_maths_passed)
                    else -> pluralStringResource(R.plurals.diag_maths_failed, check.size, check.size) + "\n\n" +
                        check.take(DiagnosticsReport.MAX_FAILURES).joinToString("\n")
                },
                icon = when {
                    check == null -> Icons.Info
                    check.isEmpty() -> Icons.CheckCircle
                    else -> Icons.Warning
                },
                tone = if (check != null && check.isNotEmpty()) Tone.PROBLEM else Tone.NEUTRAL,
            )
        }
        val i = state.info ?: return@Screen
        item(key = "versions") {
            Rows(label = stringResource(R.string.diag_versions)) {
                ListRow(stringResource(R.string.diag_app), supporting = "${i.appVersion} (build ${i.versionCode}, ${i.buildType})")
                RowDivider()
                ListRow(stringResource(R.string.diag_engine), supporting = "algorithm ${i.engineVersion}")
                RowDivider()
                ListRow(stringResource(R.string.diag_android), supporting = "${i.android} (SDK ${i.sdk})")
                RowDivider()
                ListRow(stringResource(R.string.diag_phone), supporting = i.phone)
            }
        }
        item(key = "connection") {
            Rows(label = stringResource(R.string.diag_connection)) {
                ListRow(
                    stringResource(R.string.diag_pairing),
                    supporting = stringResource(
                        when (i.pairing) {
                            PairingStatus.PAIRED -> R.string.diag_pairing_paired
                            PairingStatus.UNPAIRED -> R.string.diag_pairing_unpaired
                            PairingStatus.REVOKED -> R.string.diag_pairing_revoked
                        },
                    ),
                )
                RowDivider()
                ListRow(
                    stringResource(R.string.diag_route),
                    supporting = stringResource(
                        when (i.route) {
                            Where.HOME -> R.string.diag_route_home
                            Where.AWAY -> R.string.diag_route_away
                            null -> R.string.diag_route_unknown
                        },
                    ),
                )
                RowDivider()
                ListRow(stringResource(R.string.diag_home), supporting = i.homeHost ?: stringResource(R.string.diag_none))
                RowDivider()
                ListRow(stringResource(R.string.diag_away), supporting = i.awayHost ?: stringResource(R.string.diag_none))
                RowDivider()
                ListRow(stringResource(R.string.diag_unsent), supporting = "${i.unsentShifts} shifts · ${i.unsentFixes} points" + (i.halt?.let { " · ${it.name.lowercase()}" } ?: ""))
            }
        }
        item(key = "tracking") {
            val t = i.tracking
            Rows(label = stringResource(R.string.diag_tracking)) {
                ListRow(
                    stringResource(R.string.diag_mode),
                    supporting = listOfNotNull(t.mode.name.lowercase(), t.power?.name?.lowercase(), "fixes ${t.storedFixes}", t.problem?.name?.lowercase()).joinToString(" · "),
                )
                i.permissions?.let { p ->
                    RowDivider()
                    ListRow(
                        stringResource(R.string.diag_permissions),
                        supporting = "precise ${p.preciseLocation} · all the time ${p.backgroundLocation} · notifications ${p.notifications} · " +
                            "location on ${p.locationEnabled} · battery exempt ${p.ignoringBatteryOptimizations}",
                    )
                }
            }
        }
        item(key = "copy") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { state.summary?.let(onCopy) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.diag_copy))
                }
                Text(stringResource(R.string.diag_copy_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
