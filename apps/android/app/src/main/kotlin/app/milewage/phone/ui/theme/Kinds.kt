package app.milewage.phone.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import com.materialkolor.blend.Blend

/**
 * The colours for things that come in kinds: the web's chart series (`CHART.series` in
 * apps/web/scripts/m3-theme.mjs), the same eight in the same order, for an icon tile's tint. Never
 * Lane yellow, never a status, never money (that is earned and spent).
 */
@Immutable
class Kinds(private val colors: List<Color>) {
    /** The colour of kind [n]; past the last it starts again. */
    operator fun get(n: Int): Color = colors[n.mod(colors.size)]

    /** With wallpaper colours on: each hue moved toward the wallpaper's primary, as earned and spent are. */
    fun harmonizedWith(primary: Int): Kinds = Kinds(colors.map { Color(Blend.harmonize(it.toArgb(), primary)) })

    companion object {
        val Light = Kinds(
            listOf(0xFF2A78D6, 0xFFD4561F, 0xFF0F8A72, 0xFFA07000, 0xFFC4487B, 0xFF2F7D00, 0xFF6250D6, 0xFFD03B3B).map { Color(it) },
        )
        val Dark = Kinds(
            listOf(0xFF3987E5, 0xFFD95926, 0xFF199E70, 0xFFC98500, 0xFFD55181, 0xFF008300, 0xFF9085E9, 0xFFE66767).map { Color(it) },
        )
    }
}

val LocalKinds = staticCompositionLocalOf { Kinds.Light }
