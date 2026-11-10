package app.milewage.phone.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import java.io.File
import kotlin.math.pow
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The colour pairs the Android app draws, at WCAG 2's floors in both brand themes: text 4.5:1,
 * meaningful marks (outlines, checked controls, progress, the focus outline, icons that carry a
 * state) 3:1. The surfaces are the surface model's ([Surfaces]): the page, the card, the fill on a
 * card, the popover (dialogs, the scanner's chips). A new pairing a screen invents goes here.
 *
 * Not held to 3:1, on purpose and as Material does: the brand button's yellow container and the
 * selection pill (secondaryContainer) against the page. The button is identified by its label
 * (11:1 on the yellow), the selection by its check mark or filled icon and its label.
 */
class ContrastTest {
    private class Theme(val name: String, val c: androidx.compose.material3.ColorScheme, val e: ExtendedColors, val s: Surfaces)

    private val themes = listOf(
        Theme("light", BrandColors.Light, BrandColors.LightExtended, Surfaces.of(BrandColors.Light, isDark = false)),
        Theme("dark", BrandColors.Dark, BrandColors.DarkExtended, Surfaces.of(BrandColors.Dark, isDark = true)),
    )

    @Test
    fun textMeetsFourAndAHalf() {
        for (t in themes) {
            val c = t.c
            val grounds = mapOf("page" to t.s.page, "card" to t.s.card, "popover" to t.s.popover)
            val pairs = buildList {
                for ((g, bg) in grounds) {
                    add("onSurface on $g" to (c.onSurface to bg))
                    add("onSurfaceVariant on $g" to (c.onSurfaceVariant to bg))
                    // Text buttons, links, the section labels, the week titles: ink.
                    add("primary on $g" to (c.primary to bg))
                    // Destructive text buttons in dialogs, "Connect to a different server", "Required".
                    add("error on $g" to (c.error to bg))
                }
                add("onSurface on fill" to (c.onSurface to t.s.fill))
                add("onSurfaceVariant on fill" to (c.onSurfaceVariant to t.s.fill))
                // Money figures sit on cards (Home's deduction is neutral; earned and spent are ready for money in and out).
                add("earned on card" to (t.e.earned to t.s.card))
                add("spent on card" to (t.e.spent to t.s.card))
                add("earned on page" to (t.e.earned to t.s.page))
                add("spent on page" to (t.e.spent to t.s.page))
                add("onEarnedContainer on earnedContainer" to (t.e.onEarnedContainer to t.e.earnedContainer))
                add("onSpentContainer on spentContainer" to (t.e.onSpentContainer to t.e.spentContainer))
                // The brand button (Start shift, I have a server, Next): Asphalt on Lane yellow.
                add("onPrimaryContainer on primaryContainer" to (c.onPrimaryContainer to c.primaryContainer))
                // End shift and the problem cards.
                add("onErrorContainer on errorContainer" to (c.onErrorContainer to c.errorContainer))
                add("primary on errorContainer (a problem card's outlined button)" to (c.primary to c.errorContainer))
                // Selection: the chosen segment, chip and navigation pill; the label beside the pill.
                add("onSecondaryContainer on secondaryContainer" to (c.onSecondaryContainer to c.secondaryContainer))
                // Material's filled button, a checked switch's icon, a done permission's check.
                add("onPrimary on primary" to (c.onPrimary to c.primary))
                // Snackbars: the message and its action (inversePrimary, Android's own value).
                add("inverseOnSurface on inverseSurface" to (c.inverseOnSurface to c.inverseSurface))
                add("inversePrimary on inverseSurface" to (c.inversePrimary to c.inverseSurface))
            }
            for ((name, pair) in pairs) {
                val ratio = contrast(pair.first, pair.second)
                assertTrue(ratio >= 4.5, "${t.name} $name: ${"%.2f".format(ratio)} < 4.5")
            }
        }
    }

    @Test
    fun marksMeetThree() {
        for (t in themes) {
            val c = t.c
            val pairs = buildList {
                for ((g, bg) in mapOf("page" to t.s.page, "card" to t.s.card, "popover" to t.s.popover)) {
                    // Text-field and segmented-button outlines, an unchecked switch's border and thumb.
                    add("outline on $g" to (c.outline to bg))
                    // A checked switch's track, a checked radio or box, progress, the focused field's outline and cursor.
                    add("primary on $g" to (c.primary to bg))
                    add("error on $g" to (c.error to bg))
                }
                // The progress indicator against its track.
                add("primary on secondaryContainer (progress track)" to (c.primary to c.secondaryContainer))
                add("primary on surfaceContainerHighest (progress track)" to (c.primary to c.surfaceContainerHighest))
                // The selected navigation icon in its pill.
                add("onSecondaryContainer on secondaryContainer" to (c.onSecondaryContainer to c.secondaryContainer))
                // The route sketch: the road on the card, the lane on the road, the markers' ink on the card.
                // In light the dark road carries the route on the white card; in dark the yellow lane does.
                if (t.name == "light") add("road on card" to (t.s.road to t.s.card)) else add("lane on card" to (c.primaryContainer to t.s.card))
                add("lane on road" to (c.primaryContainer to t.s.road))
                add("onSurface marker on card" to (c.onSurface to t.s.card))
                add("onSurfaceVariant stop on card" to (c.onSurfaceVariant to t.s.card))
                // The scanner's corners on the camera (the scrim behind it).
                add("primaryContainer on scrim" to (c.primaryContainer to c.scrim))
            }
            for ((name, pair) in pairs) {
                val ratio = contrast(pair.first, pair.second)
                assertTrue(ratio >= 3.0, "${t.name} $name: ${"%.2f".format(ratio)} < 3")
            }
        }
    }

    /** The window and splash before Compose draws are the page colour of each theme. */
    @Test
    fun windowBackgroundIsThePage() {
        fun windowColour(dir: String): String =
            Regex("""<color name="window_background">(#[0-9A-Fa-f]{6})</color>""")
                .find(File("src/main/res/$dir/colors.xml").readText())!!.groupValues[1].lowercase()
        assertEquals(hex(BrandColors.Light.background), windowColour("values"))
        assertEquals(hex(BrandColors.Dark.background), windowColour("values-night"))
    }

    private fun hex(c: Color) = "#%06x".format(c.toArgb() and 0xFFFFFF)

    /** WCAG 2 contrast ratio of two opaque colours. */
    private fun contrast(a: Color, b: Color): Double {
        fun lum(argb: Int): Double {
            fun ch(v: Int): Double {
                val x = v / 255.0
                return if (x <= 0.04045) x / 12.92 else ((x + 0.055) / 1.055).pow(2.4)
            }
            return 0.2126 * ch(argb shr 16 and 0xFF) + 0.7152 * ch(argb shr 8 and 0xFF) + 0.0722 * ch(argb and 0xFF)
        }
        val (hi, lo) = listOf(lum(a.toArgb()), lum(b.toArgb())).sortedDescending()
        return (hi + 0.05) / (lo + 0.05)
    }
}
