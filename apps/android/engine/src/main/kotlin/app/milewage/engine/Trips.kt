// Port of packages/track-engine/src/trips.ts.
package app.milewage.engine

/** A trip before output rounding: distance in decimetres, state at its start. Mutable while built, as in TypeScript. */
data class TripDraft(
    val originalKind: TripState,
    val startedAt: Long,
    var endedAt: Long,
    val startLatE7: Int,
    val startLonE7: Int,
    var endLatE7: Int,
    var endLonE7: Int,
    var distanceDm: Long,
    val purpose: String,
)

/** Purpose of the single trip when the whole-shift segmenter is used (14 section 6.1). */
const val WHOLE_SHIFT_PURPOSE: String = "Business driving"

/**
 * Deterministic trip identity (14 section 6.7): `<shift client_id>:<segment start epoch ms>:<original_kind>`.
 * The same string on phone and server; driver edits are stored against it.
 */
fun makeTripKey(shiftClientId: String, startedAt: Long, originalKind: TripState): String =
    "$shiftClientId:$startedAt:${originalKind.wire}"

/**
 * The whole-shift segmenter (the segmenter slot, 14 section 17): every accepted segment
 * belongs to one `active` trip. No accepted segment means no trip.
 */
fun wholeShiftTrips(segments: List<Segment>): List<TripDraft> {
    if (segments.isEmpty()) return emptyList()
    val first = segments.first().from
    val last = segments.last().to
    var distanceDm = 0L
    for (s in segments) distanceDm += s.distanceDm
    return listOf(
        TripDraft(
            originalKind = TripState.ACTIVE,
            startedAt = first.recordedAt,
            endedAt = last.recordedAt,
            startLatE7 = first.latE7,
            startLonE7 = first.lonE7,
            endLatE7 = last.latE7,
            endLonE7 = last.lonE7,
            distanceDm = distanceDm,
            purpose = WHOLE_SHIFT_PURPOSE,
        ),
    )
}

/**
 * Turns drafts into trips with whole-metre distances that add up to the rounded total
 * exactly: each trip gets round(cumulative dm / 10) minus the previous cumulative figure,
 * so metres are rounded once overall and never drift (14 section 9.1 rule 2).
 */
fun buildTrips(shiftClientId: String, drafts: List<TripDraft>): List<Trip> {
    val trips = ArrayList<Trip>(drafts.size)
    var cumDm = 0L
    var prevM = 0L
    for (d in drafts) {
        cumDm += d.distanceDm
        val cumM = dmToM(cumDm)
        trips.add(
            Trip(
                tripKey = makeTripKey(shiftClientId, d.startedAt, d.originalKind),
                kind = d.originalKind.asKind,
                originalKind = d.originalKind,
                startedAt = d.startedAt,
                endedAt = d.endedAt,
                startLatE7 = d.startLatE7,
                startLonE7 = d.startLonE7,
                endLatE7 = d.endLatE7,
                endLonE7 = d.endLonE7,
                distanceM = cumM - prevM,
                purpose = d.purpose,
            ),
        )
        prevM = cumM
    }
    return trips
}

fun totalsOf(trips: List<Trip>): Totals {
    var totalM = 0L
    var activeM = 0L
    var deadheadM = 0L
    var personalM = 0L
    for (trip in trips) {
        totalM += trip.distanceM
        when (trip.kind) {
            TripKind.ACTIVE -> activeM += trip.distanceM
            TripKind.DEADHEAD -> deadheadM += trip.distanceM
            TripKind.PERSONAL -> personalM += trip.distanceM
        }
    }
    return Totals(totalM, activeM, deadheadM, personalM)
}
