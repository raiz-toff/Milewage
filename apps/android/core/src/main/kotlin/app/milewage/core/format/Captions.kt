package app.milewage.core.format

/** Who calculated a shift's totals (15 section 4.2). */
enum class CalcSource { PHONE, SERVER }

/** The "who calculated this" line under a shift's total; apps/phone/src/format.ts `totalsCaption`. */
fun totalsCaption(totalM: Long?, calcSource: CalcSource): String = when {
    totalM == null -> "Totals will appear once it is sent to the server"
    calcSource == CalcSource.SERVER -> "Confirmed by server"
    else -> "Calculated on phone"
}
