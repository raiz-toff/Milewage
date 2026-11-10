package app.milewage.phone.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.milewage.phone.model.Now
import app.milewage.phone.ui.theme.surfaces
import kotlinx.coroutines.delay

/**
 * False in screenshot and UI tests: clocks do not tick and nothing animates forever, so a test
 * settles. True in the app.
 */
val LocalTicking = staticCompositionLocalOf { true }

/** The phone's clock for the running shift's elapsed time (a fixed one in tests). */
val LocalNow = staticCompositionLocalOf { Now.SYSTEM }

/**
 * A large figure on one line that shrinks to fit rather than clipping (text at 200 % still fits a
 * phone's width): the running shift's time and distance, a summary's total.
 */
@Composable
fun BigFigure(text: String, style: TextStyle, modifier: Modifier = Modifier, color: Color = Color.Unspecified) {
    val c = if (color == Color.Unspecified) LocalContentColor.current else color
    BasicText(
        text = text,
        modifier = modifier,
        style = style.tabular().copy(color = c),
        maxLines = 1,
        autoSize = TextAutoSize.StepBased(minFontSize = 16.sp, maxFontSize = style.fontSize, stepSize = 2.sp),
    )
}

/**
 * The time since [startMs] ("1:04:09"), ticking each second. Only this text recomposes: the screen
 * around it does not.
 */
@Composable
fun ElapsedFigure(startMs: Long, style: TextStyle, modifier: Modifier = Modifier, format: (Long) -> String) {
    val now = LocalNow.current
    val ticking = LocalTicking.current
    val t by produceState(now.ms(), startMs, ticking) {
        value = now.ms()
        while (ticking) {
            delay(1_000 - (now.ms() - startMs).mod(1_000L))
            value = now.ms()
        }
    }
    BigFigure(format(t - startMs), style, modifier)
}

/** How serious a notice is: decides its colours, always together with an icon and words. */
enum class Tone { NEUTRAL, WARNING, PROBLEM }

/**
 * A card with an icon, a title, an optional body and at most [actionLabel] (the one way forward)
 * plus an optional quieter [secondaryLabel]. Problems are announced to TalkBack as they appear.
 */
@Composable
fun NoticeCard(
    title: String,
    modifier: Modifier = Modifier,
    body: String? = null,
    icon: ImageVector? = null,
    tone: Tone = Tone.NEUTRAL,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    secondaryLabel: String? = null,
    onSecondary: (() -> Unit)? = null,
    extra: (@Composable () -> Unit)? = null,
) {
    // NEUTRAL is a card. WARNING is outlined (the page's colour inside an outline-variant
    // hairline, the web's Alert): it stands apart from the cards without a tint, since no colour is
    // spent on "attention" and the yellow is never a status. PROBLEM is Material's error container.
    val colors = when (tone) {
        Tone.NEUTRAL -> CardDefaults.cardColors(containerColor = MaterialTheme.surfaces.card, contentColor = MaterialTheme.colorScheme.onSurface)
        Tone.WARNING -> CardDefaults.cardColors(containerColor = MaterialTheme.surfaces.page, contentColor = MaterialTheme.colorScheme.onSurface)
        Tone.PROBLEM -> CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
            contentColor = MaterialTheme.colorScheme.onErrorContainer,
        )
    }
    Card(
        modifier = modifier.fillMaxWidth().semantics { if (tone == Tone.PROBLEM) liveRegion = LiveRegionMode.Polite },
        shape = MaterialTheme.shapes.medium,
        colors = colors,
        border = if (tone == Tone.WARNING) BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant) else null,
    ) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (icon != null) Icon(icon, contentDescription = null, modifier = Modifier.size(24.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                if (body != null) {
                    Text(
                        body,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (tone == Tone.PROBLEM) Color.Unspecified else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                extra?.invoke()
                if (actionLabel != null || secondaryLabel != null) {
                    // Wraps at large text sizes instead of squeezing the buttons.
                    FlowRow(
                        Modifier.padding(top = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        if (actionLabel != null && onAction != null) {
                            OutlinedButton(onClick = onAction, modifier = Modifier.heightIn(min = 48.dp)) { Text(actionLabel) }
                        }
                        if (secondaryLabel != null && onSecondary != null) {
                            TextButton(onClick = onSecondary, modifier = Modifier.heightIn(min = 48.dp)) { Text(secondaryLabel) }
                        }
                    }
                }
            }
        }
    }
}
