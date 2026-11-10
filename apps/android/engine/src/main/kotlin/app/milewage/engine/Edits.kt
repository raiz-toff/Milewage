// Port of packages/track-engine/src/edits.ts.
package app.milewage.engine

/** The order edits are applied in, the same one the digest uses, so input order cannot matter. Strings compare as UTF-16 code units. */
fun sortEdits(edits: List<TripEdit>): List<TripEdit> =
    edits.sortedWith { a, b ->
        var c = cmp(a.tripKey, b.tripKey)
        if (c == 0) c = cmp(a.kind?.wire ?: "", b.kind?.wire ?: "")
        if (c == 0) c = cmp(a.purpose ?: "", b.purpose ?: "")
        c
    }

data class EditResult(val trips: List<Trip>, val flags: List<Flag>)

/**
 * Stage 7 (14 section 6.7). Re-applies the driver's trip edits by `tripKey`.
 * An edit changes `kind` and/or `purpose`; `originalKind`, times and distance are never
 * touched (07 section 3 rule 8). An edit whose key matches no trip is NOT applied, NOT
 * dropped and NOT re-attached to a "nearby" trip: it is returned as an `override_orphaned`
 * flag (detail = the tripKey), once per key. Two edits for one key merge field by field in
 * the fixed edit order, the later one winning.
 */
fun applyEdits(trips: List<Trip>, edits: List<TripEdit>?): EditResult {
    val out = trips.toMutableList()
    val flags = ArrayList<Flag>()
    if (edits.isNullOrEmpty()) return EditResult(out, flags)

    // tripKey -> index in `out`; a later trip with the same key wins, as with a JavaScript Map.
    val byKey = HashMap<String, Int>()
    for ((i, t) in out.withIndex()) byKey[t.tripKey] = i
    val orphaned = HashSet<String>()
    for (e in sortEdits(edits)) {
        val i = byKey[e.tripKey]
        if (i == null) {
            if (orphaned.add(e.tripKey)) flags.add(Flag(FlagCode.OVERRIDE_ORPHANED, detail = e.tripKey))
            continue
        }
        var t = out[i]
        if (e.kind != null) t = t.copy(kind = e.kind)
        if (e.purpose != null) t = t.copy(purpose = e.purpose)
        out[i] = t
    }
    return EditResult(out, flags)
}
