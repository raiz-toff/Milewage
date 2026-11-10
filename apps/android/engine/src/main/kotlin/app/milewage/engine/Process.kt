// Port of packages/track-engine/src/process.ts.
package app.milewage.engine

/**
 * The authority: batch, deterministic, no clock, no randomness (14 section 3).
 * Stages 1-4, 7 and 8 always run. Stage 5 (stops) and the stop-based segmenter run only when
 * `segmenter` is 'stops' and the shift has a stop that changes the estimate; otherwise the
 * whole-shift segmenter is used. Neither can change a total, only where trips are cut.
 */
fun processShift(input: ShiftInput): ShiftResult {
    val normalized = normalize(input.fixes, input.startedAt, input.endedAt) // 1
    val qualified = qualify(normalized) // 2
    val g = gate(qualified) // 3
    val gaps = detectGaps(g) // 4
    // 5 and 6: the segmenter slot. Stops are read from the qualified fixes, not the gated ones.
    var stops: List<Stop> = emptyList()
    var drafts = wholeShiftTrips(g.segments)
    val stopFlags = ArrayList<Flag>()
    if (input.segmenter == Segmenter.STOPS) {
        val roles = estimateRoles(detectStops(input.shiftClientId, qualified, input.startedAt), input.stopLabels)
        stops = roles.stops
        stopFlags.addAll(roles.flags)
        if (roles.changes.isNotEmpty()) {
            drafts = stopTrips(g.segments, roles.changes)
        } else {
            stopFlags.add(Flag(FlagCode.NO_STOPS_DETECTED))
        }
    }
    val built = buildTrips(input.shiftClientId, drafts)
    val edited = applyEdits(built, input.edits) // 7
    val trips = edited.trips

    val considered = normalized.size.toLong()
    val lowAccuracy = (normalized.size - qualified.size).toLong()
    val flags = ArrayList<Flag>()
    flags.addAll(gaps.flags)
    flags.addAll(edited.flags)
    flags.addAll(stopFlags)
    flags.addAll(interruptionFlags(input.interruptions))
    flags.addAll(clockSkewFlag(input.clockSkewMs))
    flags.addAll(
        qualityFlags(
            QualityCounts(
                considered = considered,
                lowAccuracy = lowAccuracy,
                accepted = g.accepted.size.toLong(),
                shiftMs = input.endedAt - input.startedAt,
            ),
        ),
    )
    if (input.autoClosed) flags.add(Flag(FlagCode.SHIFT_AUTO_CLOSED, input.endedAt))

    val stats = LinkedHashMap<String, Long>()
    stats["fixes_in"] = input.fixes.size.toLong()
    stats["fixes_used"] = g.accepted.size.toLong()
    stats["low_accuracy"] = lowAccuracy
    stats["non_positive_dt"] = g.stats.nonPositiveDt
    stats["speed_spike"] = g.stats.speedSpike
    stats["within_gate"] = g.stats.withinGate
    stats["gap_m"] = dmToM(gaps.gapDm)

    return ShiftResult(
        algorithmVersion = ALGORITHM_VERSION,
        inputDigest = inputDigest(input, normalized),
        totals = totalsOf(trips),
        trips = trips,
        stops = stops,
        route = simplifyRoute(g.accepted.map { RoutePoint(it.latE7, it.lonE7, it.recordedAt) }), // 8
        flags = sortFlags(flags),
        stats = stats,
    )
}
