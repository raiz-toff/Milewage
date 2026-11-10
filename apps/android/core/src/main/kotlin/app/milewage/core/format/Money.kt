package app.milewage.core.format

/**
 * Money is stored as whole minor units of the instance currency (`settings.currency`; server fields
 * end in `_cents`). These helpers are written without java.text so they give the same text on the
 * JVM, on Android (ICU) and later on iOS. The output follows the web's `en-CA` Intl formatting.
 */

/** Text shown for a money figure that is not available. Never 0. */
const val NOT_AVAILABLE: String = "not available"

/** ISO 4217 minor units that are not 2. */
private val MINOR_DIGITS: Map<String, Int> = buildMap {
    listOf(
        "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND",
        "VUV", "XAF", "XOF", "XPF",
    ).forEach { put(it, 0) }
    listOf("BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND").forEach { put(it, 3) }
    listOf("CLF", "UYW").forEach { put(it, 4) }
}

/** Symbols the `en-CA` locale uses (CLDR); any other currency shows its code and a no-break space. */
private val SYMBOLS: Map<String, String> = mapOf(
    "CAD" to "$", "USD" to "US$", "GBP" to "£", "EUR" to "€", "AUD" to "A$", "NZD" to "NZ$",
    "JPY" to "JP¥", "CNY" to "CN¥", "HKD" to "HK$", "MXN" to "MX$", "BRL" to "R$", "INR" to "₹",
    "KRW" to "₩", "ILS" to "₪", "TWD" to "NT$", "VND" to "₫", "PHP" to "₱",
)

/** Digits after the decimal point in a currency's minor unit: JPY 0, USD 2, KWD 3; unknown codes 2. */
fun minorDigits(currency: String): Int = MINOR_DIGITS[currency.uppercase()] ?: 2

/** Whole minor units in the instance currency ("US$12.50", "$1,250.00", "KWD 1.250"); null is "not available". */
fun formatMoney(minor: Long?, currency: String): String {
    if (minor == null) return NOT_AVAILABLE
    val code = currency.uppercase()
    val symbol = SYMBOLS[code] ?: "$code "
    val sign = if (minor < 0) "-" else ""
    return sign + symbol + plainAmount(kotlin.math.abs(minor), minorDigits(code), group = true)
}

/** Minor units as the plain number a form field shows ("12.50", "1250", "1.250"). */
fun moneyInput(minor: Long, currency: String): String =
    (if (minor < 0) "-" else "") + plainAmount(kotlin.math.abs(minor), minorDigits(currency), group = false)

/**
 * Money typed by the driver to whole minor units. Blank is 0; anything that is not a number is
 * null. A comma may stand for the decimal point ("12,50"). Extra digits round half up, as
 * JavaScript's Math.round does.
 */
fun parseMoney(text: String, currency: String): Long? {
    val t = text.trim()
    if (t.isEmpty()) return 0
    val m = Regex("""^([+-]?)(\d*)(?:\.(\d*))?$""").matchEntire(t.replaceFirst(',', '.')) ?: return null
    val (sign, whole, frac) = m.destructured
    if (whole.isEmpty() && frac.isEmpty()) return null
    val digits = minorDigits(currency)
    val kept = frac.take(digits).padEnd(digits, '0')
    var value = (whole + kept).trimStart('0').ifEmpty { "0" }.toLongOrNull() ?: return null
    val rest = frac.drop(digits)
    val negative = sign == "-"
    // Half toward +infinity on the exact decimal: positive rounds up at >= .5, negative only at > .5.
    if (rest.isNotEmpty()) {
        val firstDigit = rest[0] - '0'
        val beyondHalf = firstDigit > 5 || (firstDigit == 5 && rest.drop(1).any { it != '0' })
        val exactlyHalf = firstDigit == 5 && rest.drop(1).all { it == '0' }
        if (beyondHalf || (exactlyHalf && !negative)) value += 1
    }
    return if (negative) -value else value
}

private fun plainAmount(minor: Long, digits: Int, group: Boolean): String {
    val text = minor.toString().padStart(digits + 1, '0')
    val whole = text.dropLast(digits)
    val grouped = if (group) whole.reversed().chunked(3).joinToString(",").reversed() else whole
    return if (digits == 0) grouped else grouped + "." + text.takeLast(digits)
}
