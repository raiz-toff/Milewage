package app.milewage.phone.ui.components

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import app.milewage.phone.R
import app.milewage.phone.ui.theme.extendedColors

/** One question before something hard to undo, with the consequence spelled out in [text]. */
data class ConfirmRequest(
    val title: String,
    val text: String,
    val confirmLabel: String,
    /** Deleting or disconnecting: the confirm button is red (spent). */
    val destructive: Boolean = false,
    val onConfirm: () -> Unit,
)

/** Holds the question being asked; `confirm.ask(...)` from a click, [ConfirmHost] shows it. */
@Stable
class ConfirmState {
    var request: ConfirmRequest? by mutableStateOf(null)
        private set

    fun ask(request: ConfirmRequest) {
        this.request = request
    }

    fun dismiss() {
        request = null
    }
}

@Composable
fun rememberConfirmState(): ConfirmState = remember { ConfirmState() }

/** Shows the pending [ConfirmState] question as a Material 3 alert dialog. */
@Composable
fun ConfirmHost(state: ConfirmState) {
    val request = state.request ?: return
    val confirmColors = if (request.destructive) {
        ButtonDefaults.textButtonColors(contentColor = MaterialTheme.extendedColors.spent)
    } else {
        ButtonDefaults.textButtonColors()
    }
    AlertDialog(
        onDismissRequest = state::dismiss,
        title = { Text(request.title) },
        text = { Text(request.text) },
        confirmButton = {
            TextButton(
                colors = confirmColors,
                onClick = {
                    state.dismiss()
                    request.onConfirm()
                },
            ) { Text(request.confirmLabel) }
        },
        dismissButton = {
            TextButton(onClick = state::dismiss) { Text(stringResource(R.string.cancel)) }
        },
    )
}
