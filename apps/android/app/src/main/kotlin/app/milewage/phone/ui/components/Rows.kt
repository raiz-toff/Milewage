package app.milewage.phone.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * A list row: Material 3's list item (56 dp for one line), tappable when [onClick] is given.
 * [trailing] holds a switch, a value or a chevron; [leading] an icon.
 */
@Composable
fun ListRow(
    headline: String,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    /** The card's colour behind the row; a row on a card that is itself on a card sits one level up. */
    containerColor: Color = MaterialTheme.colorScheme.surfaceContainerLow,
    /** The headline's colour: Material's error for a destructive row. */
    headlineColor: Color = Color.Unspecified,
    /** What TalkBack calls a tappable row (a switch row says "switch"). */
    role: Role = Role.Button,
) {
    ListItem(
        headlineContent = { Text(headline, color = headlineColor) },
        supportingContent = supporting?.let { { Text(it) } },
        leadingContent = leading,
        trailingContent = trailing,
        colors = ListItemDefaults.colors(containerColor = containerColor),
        modifier = if (onClick != null) modifier.clickable(role = role, onClick = onClick) else modifier,
    )
}

/**
 * A card of [ListRow]s under an optional [SectionLabel]. Put a [RowDivider] between rows.
 */
@Composable
fun Rows(modifier: Modifier = Modifier, label: String? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier) {
        if (label != null) SectionLabel(label)
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
            content()
        }
    }
}

/** The line between two rows in [Rows]. */
@Composable
fun RowDivider() {
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

/** The name of a group of rows or cards, in the primary colour (Material 3 list subheader). */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = modifier
            .padding(start = 16.dp, end = 16.dp, bottom = 8.dp)
            .semantics { heading() },
    )
}
