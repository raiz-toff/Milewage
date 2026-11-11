package app.milewage.phone.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.milewage.phone.ui.theme.kinds
import app.milewage.phone.ui.theme.surfaces

/**
 * The colour of an [IconTile]. Roles only, and never Lane yellow: [Neutral] for a plain row,
 * [Selected] for the thing going on now (the running shift), [Problem] for what needs the driver,
 * and [Kind] for things that come in kinds (the web's chart series, in the same order: 0 blue for
 * shifts and time, 1 orange for distance, 2 teal for the deduction).
 */
sealed interface TileTone {
    data object Neutral : TileTone

    data object Selected : TileTone

    data object Problem : TileTone

    data class Kind(val n: Int) : TileTone
}

/**
 * An icon in a tonal tile (the web's `IconTile`): the picture before a row or a figure. Decoration
 * only: the words beside it say everything, so TalkBack skips it.
 */
@Composable
fun IconTile(icon: ImageVector, modifier: Modifier = Modifier, tone: TileTone = TileTone.Neutral, round: Boolean = false, size: Dp = 40.dp) {
    val scheme = MaterialTheme.colorScheme
    val (container, content) = when (tone) {
        TileTone.Neutral -> MaterialTheme.surfaces.fill to scheme.onSurfaceVariant
        TileTone.Selected -> scheme.secondaryContainer to scheme.onSecondaryContainer
        TileTone.Problem -> scheme.errorContainer to scheme.onErrorContainer
        is TileTone.Kind -> MaterialTheme.kinds[tone.n].let { it.copy(alpha = 0.15f) to it }
    }
    Box(
        modifier.size(size).background(container, if (round) CircleShape else MaterialTheme.shapes.medium),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(size / 2))
    }
}
