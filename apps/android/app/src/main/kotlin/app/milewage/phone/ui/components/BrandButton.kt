package app.milewage.phone.ui.components

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp

/** How tall the brand button is: 56 dp, or 64 dp for the in-vehicle actions (Start shift). */
enum class BrandSize(val height: Int) { REGULAR(56), VEHICLE(64) }

/**
 * The ONE brand action on a screen (design system: primary-container, Lane yellow, with
 * on-primary-container content): Get started, Start shift, Next. Every other action is tonal,
 * outlined or a text button; Material's default filled `Button` (primary) is not used for it.
 * [busy] shows a spinner in place of the icon and keeps the button disabled.
 */
@Composable
fun BrandButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    busy: Boolean = false,
    size: BrandSize = BrandSize.REGULAR,
) {
    BrandButton(onClick, modifier, enabled = enabled && !busy, size = size) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Spacer(Modifier.width(8.dp))
        } else if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(if (size == BrandSize.VEHICLE) 24.dp else ButtonDefaults.IconSize))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, style = if (size == BrandSize.VEHICLE) MaterialTheme.typography.titleMedium else MaterialTheme.typography.labelLarge)
    }
}

/** The brand button with free content. */
@Composable
fun BrandButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    size: BrandSize = BrandSize.REGULAR,
    content: @Composable RowScope.() -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ),
        contentPadding = PaddingValues(horizontal = 24.dp),
        modifier = modifier.heightIn(min = size.height.dp),
        content = content,
    )
}
