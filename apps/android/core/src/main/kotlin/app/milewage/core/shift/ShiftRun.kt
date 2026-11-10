package app.milewage.core.shift

import app.milewage.core.api.PhoneResult
import app.milewage.core.api.PointManifest
import app.milewage.core.api.Segmenter
import app.milewage.core.api.TripKind
import app.milewage.core.tracking.ClockSkew
import app.milewage.core.tracking.Interruption
import app.milewage.core.tracking.RecordedFix
import app.milewage.engine.Fix
import app.milewage.engine.ShiftInput
import app.milewage.engine.ShiftResult
import app.milewage.engine.TripEdit
import app.milewage.engine.lastFixEnd
import app.milewage.engine.processShift
import app.milewage.engine.Interruption as EngineInterruption
import app.milewage.engine.Segmenter as EngineSegmenter
import app.milewage.engine.TripKind as EngineTripKind

/** The phone's run of the shared engine over a shift (15 section 5, 14 section 9.3): result and `end` facts. */
data class PhoneRun(
    val result: ShiftResult,
    /** Which fixes went in (sent with `end`). */
    val manifest: PointManifest,
    /** The additive `shift.end` facts of 08 section 4.4. */
    val phoneResult: PhoneResult,
    /** The median phone clock minus GNSS time the input carried. */
    val clockSkewMs: Long?,
)

/**
 * Builds the engine's input from what the phone stored and runs it. Pure: the caller reads the
 * fixes, interruptions and edits, and runs this off the main thread (`ShiftModel` uses its engine
 * dispatcher): a 12-hour shift at 5 s is about 8,600 fixes.
 */
object ShiftRun {
    fun toFix(f: RecordedFix): Fix = Fix(
        seq = f.seq,
        recordedAt = f.recordedAt,
        latE7 = f.latE7.toInt(),
        lonE7 = f.lonE7.toInt(),
        // An unknown accuracy is stored as 9,999 m; anything above an Int is not a real reading.
        accuracyM = f.accuracyM.coerceAtMost(Int.MAX_VALUE.toLong()).toInt(),
        speedDmps = f.speedDmps?.toInt(),
        bearingDeg = f.bearingDeg?.toInt(),
        altitudeM = f.altitudeM?.toInt(),
    )

    fun segmenterOf(s: Segmenter): EngineSegmenter = if (s == Segmenter.STOPS) EngineSegmenter.STOPS else EngineSegmenter.WHOLE_SHIFT

    fun kindOf(k: TripKind): EngineTripKind = when (k) {
        TripKind.ACTIVE -> EngineTripKind.ACTIVE
        TripKind.DEADHEAD -> EngineTripKind.DEADHEAD
        TripKind.PERSONAL -> EngineTripKind.PERSONAL
    }

    fun kindOf(k: EngineTripKind): TripKind = when (k) {
        EngineTripKind.ACTIVE -> TripKind.ACTIVE
        EngineTripKind.DEADHEAD -> TripKind.DEADHEAD
        EngineTripKind.PERSONAL -> TripKind.PERSONAL
    }

    /** The driver's trip edits of the shift's automatic trips, in the engine's terms. */
    fun editsOf(trips: List<TripRecord>): List<TripEdit> = trips
        .filter { it.source == TripSource.AUTO && it.editedAt != null }
        .map { TripEdit(it.tripKey, kindOf(it.kind), it.purpose) }

    fun input(
        shift: ShiftRecord,
        endedAt: Long,
        fixes: List<RecordedFix>,
        interruptions: List<Interruption>,
        trips: List<TripRecord> = emptyList(),
        autoClosed: Boolean = false,
    ): ShiftInput = ShiftInput(
        shiftClientId = shift.clientId,
        startedAt = shift.startedAt,
        endedAt = endedAt,
        fixes = fixes.map(::toFix),
        segmenter = segmenterOf(shift.segmenter),
        interruptions = interruptions.map { EngineInterruption(it.fromMs, it.toMs) },
        edits = editsOf(trips),
        autoClosed = autoClosed,
        clockSkewMs = ClockSkew.medianPhoneMinusGnssMs(fixes),
    )

    /**
     * Runs the engine. Null for a shift without fixes and when the engine throws: ending a shift
     * never depends on the engine (the server calculates; the phone shows "Totals will appear
     * after sending").
     */
    fun run(input: ShiftInput, segmenter: Segmenter): PhoneRun? {
        if (input.fixes.isEmpty()) return null
        val r = try {
            processShift(input)
        } catch (_: RuntimeException) {
            return null
        }
        val seqs = input.fixes.map { it.seq }
        return PhoneRun(
            result = r,
            manifest = PointManifest(seqs.min(), seqs.max(), seqs.size.toLong()),
            phoneResult = PhoneResult(
                calcVersion = r.algorithmVersion,
                segmenter = segmenter,
                inputDigest = r.inputDigest,
                totalM = r.totals.totalM,
                activeM = r.totals.activeM,
                deadheadM = r.totals.deadheadM,
                personalM = r.totals.personalM,
                tripsCount = r.trips.size,
            ),
            clockSkewMs = input.clockSkewMs,
        )
    }

    /**
     * The end of an unfinished shift (14 section 7.4): its last qualified fix at or after the
     * start, never "now"; the start itself when it has none.
     */
    fun autoCloseEnd(startedAt: Long, fixes: List<RecordedFix>): Long =
        lastFixEnd(fixes.map(::toFix), startedAt) ?: startedAt
}
