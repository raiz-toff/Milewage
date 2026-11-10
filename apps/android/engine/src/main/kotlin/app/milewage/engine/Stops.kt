// Port of packages/track-engine/src/stops.ts.
// Stage 5 (stop detection) and the estimate of stage 6 (14 section 6). Everything here is
// integer arithmetic on the same decimetre haversine as the gate. Nothing in this file reads
// an accepted-fix distance for a total: stops only decide where a trip is cut.
//
// ALL THE CONSTANTS BELOW ARE DOCUMENTED GUESSES (14 sections 12 and 16 D16); see stops.ts.
// Changing any value is an `algorithmVersion` bump, made in the TypeScript first.
package app.milewage.engine

/** A fix belongs to a dwell within 40 m of the dwell's anchor. */
const val STOP_RADIUS_DM: Long = 400

/** A cluster shorter than 120 s is not a stop (traffic lights, brief pauses). */
const val STOP_MIN_DWELL_MS: Long = 120_000

/** An unlabelled stop must last at least 180 s to change the estimate. */
const val STOP_TOGGLE_DWELL_MS: Long = 180_000

/** A stop of 30 minutes or more is a break or long wait: flagged `long_stop`, never changes the estimate. */
const val STOP_BREAK_DWELL_MS: Long = 1_800_000

/** Confidence from dwell only: medium from 180 s, high from 600 s (14 section 6.5). */
const val STOP_MEDIUM_DWELL_MS: Long = 180_000
const val STOP_HIGH_DWELL_MS: Long = 600_000

/** Wake-up rule: a fix after a gap of 90 s or more within 150 m is the dwell's last member. */
const val STOP_WAKE_GAP_MS: Long = 90_000
const val STOP_WAKE_RADIUS_DM: Long = 1_500

/** Merge rule: two stops with anchors within 100 m and under 120 s between them are one stop. */
const val STOP_MERGE_RADIUS_DM: Long = 1_000
const val STOP_MERGE_RIDE_MS: Long = 120_000

/** Start guard: a stop starting within 5 min of the shift start and within 150 m of its first fix is not a pickup. */
const val STOP_START_GUARD_MS: Long = 300_000
const val STOP_START_GUARD_RADIUS_DM: Long = 1_500

fun stopConfidence(dwellMs: Long): Confidence =
    if (dwellMs >= STOP_HIGH_DWELL_MS) {
        Confidence.HIGH
    } else if (dwellMs >= STOP_MEDIUM_DWELL_MS) {
        Confidence.MEDIUM
    } else {
        Confidence.LOW
    }

/** `<shift client_id>:<anchor recordedAt ms>:stop`, the same string on phone and server (14 section 6.2). */
fun makeStopKey(shiftClientId: String, anchorAt: Long): String = "$shiftClientId:$anchorAt:stop"

/** A detected stop before roles. `startGuarded` stops never change the estimate. */
data class DetectedStop(
    val stopKey: String,
    val startedAt: Long,
    val endedAt: Long,
    val dwellS: Long,
    val latE7: Int,
    val lonE7: Int,
    val confidence: Confidence,
    val startGuarded: Boolean,
)

private fun dist(a: Fix, b: Fix): Long = haversineDm(a.latE7, a.lonE7, b.latE7, b.lonE7)

private class RawStop(val anchor: Fix, var endedAt: Long)

/**
 * Stage 5. `qualified` is the stage 2 output (sorted, de-duplicated, accuracy at most 50 m),
 * BEFORE the gate (stage 3): the gate drops the fixes inside a dwell, so it cannot be the input.
 * Nothing here reads the gate's minimum move.
 * One left-to-right scan; a cluster only looks ahead over fixes inside the radius.
 */
fun detectStops(shiftClientId: String, qualified: List<Fix>, shiftStartedAt: Long): List<DetectedStop> {
    val n = qualified.size
    val raw = ArrayList<RawStop>()
    var i = 0
    while (i < n) {
        val anchor = qualified[i]
        var j = i
        while (j + 1 < n && dist(anchor, qualified[j + 1]) <= STOP_RADIUS_DM) j++
        // Wake-up rule: the first fix after the cluster, after a long gap, still close by.
        val next = qualified.getOrNull(j + 1)
        if (next != null &&
            next.recordedAt - qualified[j].recordedAt >= STOP_WAKE_GAP_MS &&
            dist(anchor, next) <= STOP_WAKE_RADIUS_DM
        ) {
            j++
        }
        val endedAt = qualified[j].recordedAt
        if (endedAt - anchor.recordedAt >= STOP_MIN_DWELL_MS) {
            raw.add(RawStop(anchor, endedAt))
            i = j + 1
        } else {
            i++
        }
    }

    // Merge rule, folding left so a chain of close stops becomes one.
    val merged = ArrayList<RawStop>()
    for (s in raw) {
        val prev = merged.lastOrNull()
        if (prev != null &&
            s.anchor.recordedAt - prev.endedAt < STOP_MERGE_RIDE_MS &&
            dist(prev.anchor, s.anchor) <= STOP_MERGE_RADIUS_DM
        ) {
            prev.endedAt = s.endedAt
        } else {
            merged.add(RawStop(s.anchor, s.endedAt))
        }
    }

    val first = qualified.firstOrNull()
    return merged.map { m ->
        val anchor = m.anchor
        val dwellMs = m.endedAt - anchor.recordedAt
        DetectedStop(
            stopKey = makeStopKey(shiftClientId, anchor.recordedAt),
            startedAt = anchor.recordedAt,
            endedAt = m.endedAt,
            dwellS = dwellMs.floorDiv(1000L),
            latE7 = anchor.latE7,
            lonE7 = anchor.lonE7,
            confidence = stopConfidence(dwellMs),
            startGuarded = first != null &&
                anchor.recordedAt - shiftStartedAt <= STOP_START_GUARD_MS &&
                dist(first, anchor) <= STOP_START_GUARD_RADIUS_DM,
        )
    }
}

/** State changes in time order: from `at` (a stop's departure) the state is `state`. */
data class StateChange(val at: Long, val state: TripState)

data class RoleResult(
    val stops: List<Stop>,
    val flags: List<Flag>,
    val changes: List<StateChange>,
)

/**
 * Stage 6, the estimate (14 section 6.3). State starts as deadhead. A driver label wins:
 * pickup sets active, dropoff sets deadhead, other changes nothing. An unlabelled stop of
 * 180 s up to (not including) 30 min, not start-guarded, flips the state. `estRole` is what
 * the engine would say in the state in force at that stop; `role` is the label if any, else
 * `estRole`. A label whose stop no longer exists is returned as `label_orphaned`.
 */
fun estimateRoles(detected: List<DetectedStop>, labels: List<StopLabelInput>?): RoleResult {
    // Sorted by (stopKey, role) as strings; LinkedHashMap keeps the first insertion position of
    // a key and the last value, like a JavaScript Map.
    val byKey = LinkedHashMap<String, LabelRole>()
    val sorted = (labels ?: emptyList()).sortedWith { a, b ->
        val c = cmp(a.stopKey, b.stopKey)
        if (c != 0) c else cmp(a.role.wire, b.role.wire)
    }
    for (l in sorted) byKey[l.stopKey] = l.role // later in sorted order wins
    val flags = ArrayList<Flag>()
    val stops = ArrayList<Stop>()
    val changes = ArrayList<StateChange>()
    var state = TripState.DEADHEAD
    val known = HashSet<String>()
    for (d in detected) {
        known.add(d.stopKey)
        val dwellMs = d.endedAt - d.startedAt
        val flips = !d.startGuarded && dwellMs >= STOP_TOGGLE_DWELL_MS && dwellMs < STOP_BREAK_DWELL_MS
        val estRole = if (!flips) EstRole.NONE else if (state == TripState.DEADHEAD) EstRole.PICKUP else EstRole.DROPOFF
        val role: StopRole = when (byKey[d.stopKey]) {
            LabelRole.PICKUP -> StopRole.PICKUP
            LabelRole.DROPOFF -> StopRole.DROPOFF
            LabelRole.OTHER -> StopRole.OTHER
            null -> when (estRole) {
                EstRole.PICKUP -> StopRole.PICKUP
                EstRole.DROPOFF -> StopRole.DROPOFF
                EstRole.NONE -> StopRole.NONE
            }
        }
        if (dwellMs >= STOP_BREAK_DWELL_MS) flags.add(Flag(FlagCode.LONG_STOP, d.startedAt, d.stopKey))
        val next: TripState? = when (role) {
            StopRole.PICKUP -> TripState.ACTIVE
            StopRole.DROPOFF -> TripState.DEADHEAD
            else -> null
        }
        if (next != null && next != state) {
            state = next
            changes.add(StateChange(d.endedAt, state))
        }
        stops.add(
            Stop(
                stopKey = d.stopKey,
                startedAt = d.startedAt,
                endedAt = d.endedAt,
                dwellS = d.dwellS,
                latE7 = d.latE7,
                lonE7 = d.lonE7,
                confidence = d.confidence,
                estRole = estRole,
                role = role,
            ),
        )
    }
    for (stopKey in byKey.keys) {
        if (stopKey !in known) flags.add(Flag(FlagCode.LABEL_ORPHANED, detail = stopKey))
    }
    return RoleResult(stops, flags, changes)
}

fun estimatedPurpose(state: TripState): String =
    when (state) {
        TripState.ACTIVE -> "Delivery (estimated)"
        TripState.DEADHEAD -> "Between deliveries (estimated)"
    }

/** `ESTIMATED_PURPOSE` of stops.ts. */
val ESTIMATED_PURPOSE: Map<TripState, String> = TripState.entries.associateWith(::estimatedPurpose)

/**
 * The stop-based segmenter (the segmenter slot). Each accepted segment takes the state in
 * force at its END time; a state starts at the stop's departure, so a segment ending exactly
 * at `endedAt` (the wake-up fix) already belongs to the new state. Cuts happen only where
 * the state changes, and distance is only partitioned, never altered.
 */
fun stopTrips(segments: List<Segment>, changes: List<StateChange>): List<TripDraft> {
    val drafts = ArrayList<TripDraft>()
    var state = TripState.DEADHEAD
    var c = 0
    var cur: TripDraft? = null
    for (s in segments) {
        while (c < changes.size && changes[c].at <= s.to.recordedAt) state = changes[c++].state
        if (cur == null || cur.originalKind != state) {
            cur = TripDraft(
                originalKind = state,
                startedAt = s.from.recordedAt,
                endedAt = s.to.recordedAt,
                startLatE7 = s.from.latE7,
                startLonE7 = s.from.lonE7,
                endLatE7 = s.to.latE7,
                endLonE7 = s.to.lonE7,
                distanceDm = 0,
                purpose = estimatedPurpose(state),
            )
            drafts.add(cur)
        }
        cur.endedAt = s.to.recordedAt
        cur.endLatE7 = s.to.latE7
        cur.endLonE7 = s.to.lonE7
        cur.distanceDm += s.distanceDm
    }
    return drafts
}
