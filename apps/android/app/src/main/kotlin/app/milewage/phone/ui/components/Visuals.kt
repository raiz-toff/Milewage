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
import app.milewage.phone.ui.theme.surfaces

/**
 * What an [IconTile]'s icon means, which decides its colour. Colour only where it means something,
 * as in Google's own apps: [Problem] is red (what needs the driver, a destructive row), [Selected]
 * is ink (the thing going on now). [Neutral] and [Kind] are the same quiet grey: a list of rows is
 * read by its words, not a rainbow of tiles.
 */
sealed interface TileTone {
    data object Neutral : TileTone

    data object Selected : TileTone

    data object Problem : TileTone

    data class Kind(val n: Int) : TileTone
}

/**
 * The picture before a row: a plain 24 dp Material symbol, no tile behind it. At [size] over 48 dp
 * (an empty state's picture) it sits in a soft circle. Decoration only: the words beside it say
 * everything, so TalkBack skips it.
 */
@Composable
fun IconTile(icon: ImageVector, modifier: Modifier = Modifier, tone: TileTone = TileTone.Neutral, size: Dp = 24.dp) {
    val scheme = MaterialTheme.colorScheme
    val tint = when (tone) {
        TileTone.Neutral, is TileTone.Kind -> scheme.onSurfaceVariant
        TileTone.Selected -> scheme.primary
        TileTone.Problem -> scheme.error
    }
    if (size > 48.dp) {
        Box(modifier.size(size).background(MaterialTheme.surfaces.fill, CircleShape), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(size / 2))
        }
    } else {
        Icon(icon, contentDescription = null, tint = tint, modifier = modifier.size(size))
    }
}
