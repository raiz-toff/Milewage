package app.milewage.phone.ui.components

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier

/**
 * Short messages for every screen, shown by the shell's one snackbar host. A message that reports
 * a problem carries one way forward ([actionLabel] with [onAction]: "Fix permissions", "Try again",
 * "View shift"), so it is never a dead end.
 */
@Stable
class Snackbars {
    val host = SnackbarHostState()

    suspend fun show(message: String, actionLabel: String? = null, onAction: (() -> Unit)? = null) {
        val result = host.showSnackbar(
            message = message,
            actionLabel = actionLabel,
            withDismissAction = actionLabel == null,
            duration = if (actionLabel != null) SnackbarDuration.Long else SnackbarDuration.Short,
        )
        if (result == SnackbarResult.ActionPerformed) onAction?.invoke()
    }
}

val LocalSnackbars = staticCompositionLocalOf<Snackbars> { error("No Snackbars provided: wrap the screen in AppShell") }

@Composable
fun MileWageSnackbarHost(snackbars: Snackbars, modifier: Modifier = Modifier) {
    SnackbarHost(snackbars.host, modifier)
}
