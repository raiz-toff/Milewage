package app.milewage.phone.logic

/**
 * The second line of a trip row on a shift's detail: its kind, its purpose, then "estimated" for a
 * trip the server worked out from stops, or "added" for one the driver added. The server's own
 * purposes for estimated trips already say so ("Between deliveries (estimated)"), so the word is
 * not added a second time.
 */
object TripMarks {
    fun of(kind: String?, purpose: String, estimated: Boolean, added: Boolean, estimatedWord: String, addedWord: String): List<String> {
        val p = purpose.trim()
        val saysEstimated = p.contains(estimatedWord, ignoreCase = true)
        return listOfNotNull(
            kind,
            p.takeIf { it.isNotEmpty() },
            estimatedWord.takeIf { estimated && !saysEstimated },
            addedWord.takeIf { added },
        )
    }
}
