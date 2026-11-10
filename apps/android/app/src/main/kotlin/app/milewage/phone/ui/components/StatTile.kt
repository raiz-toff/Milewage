package app.milewage.phone.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import app.milewage.phone.ui.theme.extendedColors

/** What a figure means, which decides its colour: green is money in only, red money out only. */
enum class StatTone { NEUTRAL, EARNED, SPENT }

/**
 * One figure with its label and an optional line under it ("gross · 41 h"). Numbers use tabular
 * figures so they line up. A figure not computed yet is a dash (the formatting helpers give it).
 */
@Composable
fun StatTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    caption: String? = null,
    tone: StatTone = StatTone.NEUTRAL,
) {
    val valueColor = when (tone) {
        StatTone.NEUTRAL -> Color.Unspecified
        StatTone.EARNED -> MaterialTheme.extendedColors.earned
        StatTone.SPENT -> MaterialTheme.extendedColors.spent
    }
    Card(
        modifier = modifier.clearAndSetSemantics {
            contentDescription = listOfNotNull(label, value, caption).joinToString(", ")
        },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.headlineSmall.tabular(), color = valueColor)
            if (caption != null) {
                Text(caption, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** Figures of equal width, so columns of numbers line up. */
fun TextStyle.tabular(): TextStyle = copy(fontFeatureSettings = "tnum")
