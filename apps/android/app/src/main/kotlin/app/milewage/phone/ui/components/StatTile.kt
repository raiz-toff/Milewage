package app.milewage.phone.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import app.milewage.phone.ui.theme.extendedColors

/** What a figure means, which decides its colour: green is money in only, red money out only. */
enum class StatTone { NEUTRAL, EARNED, SPENT }

/**
 * One figure with its label and an optional line under it ("gross · 41 h"), on its own card.
 * Numbers use tabular figures so they line up. A figure not computed yet is a dash (the
 * formatting helpers give it). Figures that belong together go in one card instead: [StatCell]s
 * in a [FigureRow].
 */
@Composable
fun StatTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    caption: String? = null,
    tone: StatTone = StatTone.NEUTRAL,
    icon: ImageVector? = null,
    tile: TileTone = TileTone.Neutral,
) {
    CardSurface(modifier) { StatCell(label, value, Modifier.fillMaxWidth(), caption, tone, icon, tile) }
}

/** A [StatTile]'s content without the card: one figure inside a card, read out as one sentence. */
@Composable
fun StatCell(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    caption: String? = null,
    tone: StatTone = StatTone.NEUTRAL,
    /** A picture for the figure, in an [IconTile] of colour [tile], above the label. */
    icon: ImageVector? = null,
    tile: TileTone = TileTone.Neutral,
) {
    val valueColor = when (tone) {
        StatTone.NEUTRAL -> Color.Unspecified
        StatTone.EARNED -> MaterialTheme.extendedColors.earned
        StatTone.SPENT -> MaterialTheme.extendedColors.spent
    }
    Column(
        modifier
            .clearAndSetSemantics { contentDescription = listOfNotNull(label, value, caption).joinToString(", ") }
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) IconTile(icon, Modifier.padding(bottom = 8.dp), tile)
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.headlineSmall.tabular(), color = valueColor)
        if (caption != null) {
            Text(caption, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/**
 * Figures side by side inside a card, split by outline-variant hairlines and of equal height:
 * `FigureRow { StatCell(...); StatCell(...) }`. Each child gets an equal share of the width.
 */
@Composable
fun FigureRow(modifier: Modifier = Modifier, cells: List<@Composable (Modifier) -> Unit>) {
    Row(modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        cells.forEachIndexed { i, cell ->
            if (i > 0) VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(vertical = 16.dp))
            cell(Modifier.weight(1f).fillMaxHeight())
        }
    }
}

/** Figures of equal width, so columns of numbers line up. */
fun TextStyle.tabular(): TextStyle = copy(fontFeatureSettings = "tnum")
