package app.milewage.phone.ui.components

import android.content.res.Resources
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import app.milewage.core.sync.OtherServerShifts
import app.milewage.phone.R
import app.milewage.phone.ui.icons.Icons

/**
 * Shifts recorded for another server, on Home and in Settings > Sending: how many, that they were
 * never sent, the server they go to, and the two ways forward. Connecting to that server again comes
 * first; deleting asks first ([otherServerDeleteRequest]). Nothing shows when there are none.
 */
@Composable
fun OtherServerCard(info: OtherServerShifts, onConnect: () -> Unit, onDelete: () -> Unit) {
    if (info.none) return
    val n = info.shifts
    val host = info.hosts.singleOrNull()
    NoticeCard(
        title = pluralStringResource(R.plurals.other_server_title, n, n),
        body = if (host != null) pluralStringResource(R.plurals.other_server_body_host, n, host) else pluralStringResource(R.plurals.other_server_body, n),
        icon = Icons.Server,
        tone = Tone.WARNING,
        actionLabel = stringResource(R.string.other_server_connect),
        onAction = onConnect,
        secondaryLabel = stringResource(R.string.other_server_delete),
        onSecondary = onDelete,
    )
}

/** "Delete 2 shifts from this phone?", naming how many and that they were never sent. Destructive. */
fun otherServerDeleteRequest(res: Resources, shifts: Int, onConfirm: () -> Unit) = ConfirmRequest(
    title = res.getQuantityString(R.plurals.other_server_delete_title, shifts, shifts),
    text = res.getQuantityString(R.plurals.other_server_delete_text, shifts),
    confirmLabel = res.getString(R.string.other_server_delete_confirm),
    destructive = true,
    onConfirm = onConfirm,
)
