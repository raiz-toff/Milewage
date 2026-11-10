package app.milewage.core.format

/**
 * The driver's distance unit (Settings > Distance unit). The server stores every distance in whole
 * metres (fields end in `_m`); this file is the only place that converts. Mirrors
 * apps/phone/src/format.ts and apps/web/src/format.ts.
 */
enum class DistanceUnit(val label: String, internal val millimetres: Long) {
    KM("km", 1_000_000),
    MI("mi", 1_609_344);

    /** Metres per unit, as the TypeScript helpers write it (1000, 1609.344). */
    val metres: Double get() = millimetres / 1000.0
}

/** The dash shown for a figure that is not computed yet. Never 0. */
const val DASH: String = "—"

/** A distance in the driver's unit to whole metres; `Math.round(value * metresPer(unit))` in TypeScript. */
fun toMetres(value: Double, unit: DistanceUnit): Long = kotlin.math.floor(value * unit.metres + 0.5).toLong()

/**
 * Whole metres in the driver's unit with one decimal ("12.3 km", "7.6 mi"); null is a dash.
 * Integer arithmetic, halves up, so it agrees with JavaScript's `toFixed(1)` on the same metres.
 */
fun formatDistance(m: Long?, unit: DistanceUnit): String {
    if (m == null) return DASH
    // tenths of a unit = m * 10 000 / millimetres-per-unit, rounded half up (away from zero for negatives, as toFixed does)
    val num = kotlin.math.abs(m) * 10_000
    val tenths = (2 * num + unit.millimetres) / (2 * unit.millimetres)
    val sign = if (m < 0) "-" else "" // toFixed keeps the sign of a negative that rounds to 0.0
    return "$sign${tenths / 10}.${tenths % 10} ${unit.label}"
}

/**
 * A distance typed by the driver ("12,480.5": thousands commas are allowed) to whole metres; null
 * when it is blank, negative or not a number.
 */
fun parseDistance(text: String, unit: DistanceUnit): Long? {
    val t = text.trim().replace(",", "")
    if (!Regex("""^\d+(\.\d+)?$""").matches(t)) return null
    return toMetres(t.toDouble(), unit)
}
