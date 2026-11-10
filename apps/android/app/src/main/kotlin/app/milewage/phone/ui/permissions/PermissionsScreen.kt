package app.milewage.phone.ui.permissions

import android.content.ActivityNotFoundException
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import app.milewage.data.connect.AndroidNet
import app.milewage.phone.R
import app.milewage.phone.ui.theme.surfaces
import app.milewage.phone.ui.components.CardSurface
import app.milewage.phone.logic.BatteryAdvice
import app.milewage.phone.logic.PermAction
import app.milewage.phone.logic.PermState
import app.milewage.phone.logic.PermStep
import app.milewage.phone.logic.PermStepId
import app.milewage.phone.logic.PermissionLadder
import app.milewage.phone.logic.RecordMode
import app.milewage.phone.platform.ActivityPermissions
import app.milewage.phone.platform.SystemScreens
import app.milewage.phone.ui.Texts
import app.milewage.phone.ui.components.BottomAction
import app.milewage.phone.ui.components.BrandButton
import app.milewage.phone.ui.components.LocalSnackbars
import app.milewage.phone.ui.components.NoticeCard
import app.milewage.phone.ui.components.Screen
import app.milewage.phone.ui.components.Tone
import app.milewage.phone.ui.icons.Icons
import kotlinx.coroutines.launch

/** What the permissions screen shows: the steps, what recording can do with them, the battery advice. */
data class PermissionsState(
    val steps: List<PermStep>,
    val mode: RecordMode,
    val battery: BatteryAdvice,
    /** The system's own "Allow all the time" (Android 11+), else null for the app's words. */
    val allTheTimeLabel: String?,
)

/**
 * The permissions ladder as a screen: from first run ([setup]: a Next button to Ready), from Home's
 * checklist and every "Fix permissions" (a back arrow). The phone's state is read again on every
 * resume (settings change without a prompt) and after every prompt.
 */
@Composable
fun PermissionsRoute(setup: Boolean, net: AndroidNet?, onBack: () -> Unit, onNext: () -> Unit) {
    val context = LocalContext.current
    val res = LocalResources.current
    val snackbars = LocalSnackbars.current
    val scope = rememberCoroutineScope()
    fun read(): PermissionsState {
        val facts = ActivityPermissions.facts(context, net)
        return PermissionsState(
            PermissionLadder.steps(facts),
            PermissionLadder.mode(facts),
            PermissionLadder.battery(facts.maker),
            ActivityPermissions.allTheTimeLabel(context),
        )
    }
    var state by remember { mutableStateOf(read()) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { state = read() }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { state = read() }

    fun open(block: () -> Unit) {
        try {
            block()
        } catch (_: ActivityNotFoundException) {
            scope.launch {
                snackbars.show(res.getString(R.string.perm_not_opened), res.getString(R.string.open_app_settings)) { SystemScreens.appSettings(context) }
            }
        }
    }

    fun act(step: PermStep) {
        when (step.action) {
        PermAction.NONE -> Unit
        PermAction.REQUEST -> {
            val permissions = ActivityPermissions.permissionsFor(step.id)
            if (permissions.isNotEmpty()) {
                ActivityPermissions.markAsked(context, step.id)
                open { launcher.launch(permissions) }
            }
        }
        PermAction.APP_SETTINGS -> open { SystemScreens.appSettings(context) }
        PermAction.LOCATION_SETTINGS -> open { SystemScreens.locationSettings(context) }
        PermAction.BATTERY_LIST -> open { SystemScreens.batterySettings(context) }
        PermAction.NOTIFICATION_SETTINGS -> open { SystemScreens.notificationSettings(context) }
        }
    }

    PermissionsContent(state, setup, onAction = ::act, onCheckAgain = { state = read() }, onBack = onBack, onNext = onNext)
}

@Composable
fun PermissionsContent(
    state: PermissionsState,
    setup: Boolean,
    onAction: (PermStep) -> Unit,
    onCheckAgain: () -> Unit,
    onBack: () -> Unit,
    onNext: () -> Unit,
) {
    Screen(
        title = stringResource(R.string.perm_title),
        onBack = if (setup) null else onBack,
        bottomBar = {
            if (setup) BottomAction { BrandButton(stringResource(R.string.next), onNext, Modifier.fillMaxWidth()) }
        },
    ) {
        item { Text(stringResource(R.string.perm_intro), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        item(key = "mode") { ModeCard(state.mode, state.steps) }
        state.steps.forEach { step -> item(key = step.id.name) { StepCard(step, state, onAction) } }
        item(key = "again") {
            TextButton(onClick = onCheckAgain, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.check_again)) }
        }
        if (setup) {
            item(key = "left") {
                Text(stringResource(R.string.perm_left_note), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** What recording can do with what is allowed, in one sentence and its consequence. */
@Composable
private fun ModeCard(mode: RecordMode, steps: List<PermStep>) {
    val left = PermissionLadder.next(steps) != null
    when (mode) {
        RecordMode.NONE -> NoticeCard(
            title = stringResource(R.string.perm_mode_none),
            body = stringResource(R.string.perm_mode_none_detail),
            icon = Icons.LocationOff,
            tone = Tone.PROBLEM,
        )
        RecordMode.WHILE_IN_USE, RecordMode.FULL -> NoticeCard(
            title = stringResource(R.string.perm_mode_ok),
            body = stringResource(if (left) R.string.perm_mode_ok_left else R.string.perm_mode_ok_all),
            icon = Icons.CheckCircle,
        )
    }
}

private fun iconOf(id: PermStepId): ImageVector = when (id) {
    PermStepId.LOCATION_SWITCH -> Icons.MyLocation
    PermStepId.LOCATION -> Icons.Location
    PermStepId.ALL_THE_TIME -> Icons.AllTheTime
    PermStepId.NOTIFICATIONS -> Icons.Notifications
    PermStepId.BATTERY -> Icons.Battery
    PermStepId.LOCAL_NETWORK -> Icons.LocalNetwork
}

/**
 * One step: what it is for in one sentence, its state in words (never colour alone: a done step
 * has a check and "Allowed"), and one button that does the right thing on this Android version.
 */
@Composable
private fun StepCard(step: PermStep, state: PermissionsState, onAction: (PermStep) -> Unit) {
    val done = step.state == PermState.DONE
    val label = state.allTheTimeLabel ?: stringResource(R.string.perm_all_the_time_option)
    CardSurface(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(40.dp).background(
                        // Done is a checked control: ink, like a ticked box. To do is a fill on the card.
                        if (done) MaterialTheme.colorScheme.primary else MaterialTheme.surfaces.fill,
                        CircleShape,
                    ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (done) Icons.Check else iconOf(step.id),
                        contentDescription = null,
                        tint = if (done) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        if (step.id == PermStepId.ALL_THE_TIME) stringResource(R.string.perm_always_title, label) else stringResource(Texts.permTitle(step.id)),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.semantics { heading() },
                    )
                    Text(
                        stringResource(Texts.permState(step.id, step.state)),
                        style = MaterialTheme.typography.labelLarge,
                        color = if (step.state == PermState.BLOCKED || (step.required && !done)) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (!done) {
                Text(stringResource(Texts.permPurpose(step.id)), style = MaterialTheme.typography.bodyMedium)
                if (step.id == PermStepId.LOCATION) {
                    Text(stringResource(R.string.perm_disclosure), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (step.id == PermStepId.BATTERY) {
                    Text(
                        stringResource(if (state.battery == BatteryAdvice.SAMSUNG) R.string.perm_battery_samsung else R.string.perm_battery_other),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (step.id == PermStepId.ALL_THE_TIME && step.state != PermState.WAITING) {
                    Text(stringResource(R.string.perm_always_how, label), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (step.action != PermAction.NONE) {
                    FilledTonalButton(onClick = { onAction(step) }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(
                            if (step.id == PermStepId.ALL_THE_TIME && step.action == PermAction.REQUEST) {
                                stringResource(R.string.perm_choose, label)
                            } else {
                                stringResource(Texts.permAction(step.id, step.action))
                            },
                        )
                    }
                }
            }
        }
    }
}
