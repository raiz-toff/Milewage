package app.milewage.core.shift

import app.milewage.core.api.ChangeType
import app.milewage.core.api.ShiftChange
import app.milewage.core.api.TripKind
import app.milewage.core.format.dayOf
import app.milewage.core.ports.Clock
import app.milewage.core.sync.Outbox
import app.milewage.core.tracking.CommandOutcome
import app.milewage.core.tracking.Interruption
import app.milewage.core.tracking.ShiftCommands
import app.milewage.engine.Flag
import app.milewage.engine.ShiftResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

sealed interface StartResult {
    data class Started(val shift: ShiftRecord) : StartResult

    /** No credential on the phone: a shift is started only on a paired phone. */
    data object NotPaired : StartResult

    /** A shift already runs; only one at a time. */
    data class AlreadyRunning(val shift: ShiftRecord) : StartResult

    /** The tracker could not start (no location permission, Android refused the service). Nothing was written. */
    data object RecorderRefused : StartResult
}

sealed interface EndResult {
    data class Ended(val shift: ShiftRecord, val run: PhoneRun?) : EndResult

    data object NoShift : EndResult
}

/** What [ShiftModel.recover] did at app start. */
enum class Recovery {
    /** No running shift. */
    NONE,

    /** The running shift is being recorded. */
    RECORDING,

    /** The tracker was not recording the running shift and was started again. */
    RESUMED,

    /** The tracker could not be started again: the screen should offer to end the shift. */
    NOT_RECORDING,

    /** An "End shift" cut short by a kill was finished. */
    FINISHED_END,

    /** The running shift had recorded nothing for [ShiftModel.AUTO_CLOSE_AFTER_MS]: ended at its last fix. */
    AUTO_CLOSED,
}

/** The answer to a driver edit (15 section 8.1). */
sealed interface EditResult {
    data object Ok : EditResult

    data class Refused(val reason: Reason) : EditResult

    enum class Reason { NO_SHIFT, FINALIZED, RUNNING, NO_TRIP, INVALID }
}

/** What the shift model tells diagnostics at a shift's end (no coordinates). */
fun interface ShiftEndListener {
    suspend fun ended(shift: ShiftRecord, run: PhoneRun?, engineMs: Long)
}

/**
 * Start and end a shift, the phone's run of the shared engine at the end, recovery after a kill,
 * and the driver's edits (09 section 5, 15 sections 5 and 8; decision 1.5a: the phone is a working
 * local app for weeks offline). A port of the Expo app's `shift/controller.ts` and `store/edits.ts`.
 *
 * Record first, tell the server second: every operation writes the database (shift row, readings,
 * edits and the outbox, in one transaction) before it returns, and never waits for the network.
 * The shift's create is queued at the start like every other change; the [Sender] sends it at once
 * when it can. Ending is safe to repeat after a kill: the end time is stored first, then the engine
 * runs, then the result, the outbox entries and the status change commit together.
 */
class ShiftModel(
    private val store: LocalStore,
    private val outbox: Outbox,
    private val recorder: Recorder,
    /** The paired server's flags, or null when not paired. */
    private val context: suspend () -> ShiftContext?,
    private val clock: Clock,
    private val newId: () -> String = ::newClientId,
    private val battery: BatteryPort? = null,
    /** Where the engine runs: never the main thread. */
    private val engine: CoroutineDispatcher = Dispatchers.Default,
    /** Something was queued: wake the sender. */
    private val onQueued: () -> Unit = {},
    private val onEnded: ShiftEndListener = ShiftEndListener { _, _, _ -> },
) {
    private val lock = Mutex()

    /** The running shift, if any. */
    suspend fun running(): ShiftRecord? = store.runningShift()?.takeIf { it.endedAt == null }

    /**
     * Starts a shift with [vehicleId] at [startedAt] (now, or a detected drive's start). Records
     * first: the tracker starts before anything is written, so a refusal leaves nothing behind.
     */
    suspend fun start(vehicleId: Long, odometerStartM: Long? = null, startedAt: Long = clock.nowMs()): StartResult = lock.withLock {
        val ctx = context() ?: return@withLock StartResult.NotPaired
        store.runningShift()?.let { return@withLock StartResult.AlreadyRunning(it) }
        val id = newId()
        // With the tracking module off on the server the tracker does not run at all (08 F22).
        if (ctx.tracking && !recorder.start(id, startedAt)) return@withLock StartResult.RecorderRefused
        val shift = ShiftRecord(
            clientId = id,
            vehicleId = vehicleId,
            status = ShiftStatus.RUNNING,
            segmenter = ctx.segmenter,
            startedAt = startedAt,
            localDate = dayOf(startedAt, ctx.timezone).toString(),
            updatedAt = clock.nowMs(),
            batteryStart = readBattery(),
        )
        try {
            store.transaction {
                store.upsertShift(shift)
                outbox.enqueue(ShiftChange.Create(id, vehicleId, startedAt, ctx.segmenter))
                if (odometerStartM != null) {
                    store.upsertOdometer(OdometerRecord(id, OdometerKind.SHIFT_START, odometerStartM, startedAt))
                    outbox.enqueue(ShiftChange.Odometer(id, OdometerKind.SHIFT_START.toApi(), odometerStartM.toDouble(), startedAt))
                }
                store.put(K_LAST_VEHICLE, vehicleId.toString())
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: RuntimeException) {
            if (ctx.tracking) recorder.stop()
            throw e
        }
        onQueued()
        StartResult.Started(shift)
    }

    /** The vehicle of the previous shift, to preselect it; null if none. */
    suspend fun lastVehicleId(): Long? = store.get(K_LAST_VEHICLE)?.toLongOrNull()

    /** Edits the running shift's start reading (whole metres). */
    suspend fun setOdometerStart(readingM: Long): EditResult {
        val shift = running() ?: return EditResult.Refused(EditResult.Reason.NO_SHIFT)
        if (readingM < 0) return EditResult.Refused(EditResult.Reason.INVALID)
        store.transaction {
            store.upsertOdometer(OdometerRecord(shift.clientId, OdometerKind.SHIFT_START, readingM, shift.startedAt))
            outbox.enqueue(ShiftChange.Odometer(shift.clientId, OdometerKind.SHIFT_START.toApi(), readingM.toDouble(), shift.startedAt))
        }
        onQueued()
        return EditResult.Ok
    }

    /** "End shift": stops the tracker, runs the engine over the stored fixes and queues the end. */
    suspend fun end(odometerEndM: Long? = null): EndResult = endAt(clock.nowMs(), odometerEndM, autoClosed = false)

    private suspend fun endAt(endedAt: Long, odometerEndM: Long?, autoClosed: Boolean): EndResult = lock.withLock {
        val shift = store.runningShift() ?: return@withLock EndResult.NoShift
        val ending = if (shift.endedAt != null) {
            shift
        } else {
            recorder.stop()
            val e = shift.copy(
                endedAt = endedAt,
                autoClosed = autoClosed,
                batteryEnd = if (shift.batteryStart != null) readBattery() else null,
                updatedAt = clock.nowMs(),
            )
            // The end time is stored first: a kill from here on is finished by recover().
            store.transaction {
                store.upsertShift(e)
                if (odometerEndM != null) {
                    store.upsertOdometer(OdometerRecord(e.clientId, OdometerKind.SHIFT_END, odometerEndM, endedAt))
                    outbox.enqueue(ShiftChange.Odometer(e.clientId, OdometerKind.SHIFT_END.toApi(), odometerEndM.toDouble(), endedAt))
                }
            }
            e
        }
        handOff(ending)
    }

    /**
     * Ends the shift on the phone (15 section 5): the engine over every stored fix, then in one
     * transaction the result, the interruptions, `shift.end` with the manifest and the phone result,
     * and the status. Everything shows offline from then on.
     */
    private suspend fun handOff(shift: ShiftRecord): EndResult {
        val endedAt = requireNotNull(shift.endedAt)
        val interruptions = (recorder.interruptions(shift.clientId) + store.interruptions(shift.clientId)).distinct()
        val ctxTracking = context()?.tracking ?: true
        val t0 = clock.nowMs()
        val run = if (ctxTracking) computeRun(shift, endedAt, interruptions, emptyList(), shift.autoClosed) else null
        val engineMs = clock.nowMs() - t0
        val ended = shift.copy(
            status = ShiftStatus.ENDED,
            distances = run?.result?.totals?.let { Distances(it.totalM, it.activeM, it.deadheadM, it.personalM) },
            calcVersion = run?.result?.algorithmVersion,
            inputDigest = run?.result?.inputDigest,
            phoneFlags = run?.result?.flags ?: emptyList(),
            calcSource = CalcSource.PHONE,
            manifest = run?.manifest,
            clockSkewMs = run?.clockSkewMs,
            engineMs = engineMs,
            updatedAt = clock.nowMs(),
        )
        store.transaction {
            if (!outbox.has(ChangeType.SHIFT_END, shift.clientId)) {
                outbox.enqueue(
                    ShiftChange.End(
                        clientId = shift.clientId,
                        endedAt = endedAt,
                        manifest = run?.manifest,
                        phoneResult = run?.phoneResult,
                        interruptions = interruptions.map { app.milewage.core.api.Interruption(it.fromMs, it.toMs) },
                    ),
                )
            }
            store.replaceInterruptions(shift.clientId, interruptions)
            store.upsertShift(ended)
            if (run != null) store.replaceResult(shift.clientId, tripsOf(shift, run.result), stopsOf(shift, run.result), routeOf(run.result))
        }
        onQueued()
        runCatching { onEnded.ended(ended, run, engineMs) }
        return EndResult.Ended(ended, run)
    }

    /** Runs the engine over the shift's stored fixes on [engine] (never the main thread). */
    suspend fun computeRun(
        shift: ShiftRecord,
        endedAt: Long,
        interruptions: List<Interruption>,
        trips: List<TripRecord>,
        autoClosed: Boolean,
    ): PhoneRun? {
        val fixes = store.fixes.fixesFor(shift.clientId)
        return withContext(engine) { ShiftRun.run(ShiftRun.input(shift, endedAt, fixes, interruptions, trips, autoClosed), shift.segmenter) }
    }

    /** The engine over what is on the phone now, for an ended shift (the restore resend's `end`). */
    suspend fun phoneRun(shift: ShiftRecord): PhoneRun? {
        val endedAt = shift.endedAt ?: return null
        if (store.manifest(shift.clientId) == null) return null
        return computeRun(shift, endedAt, store.interruptions(shift.clientId), store.trips(shift.clientId), shift.autoClosed)
    }

    /**
     * At app start: finishes an "End shift" cut short by a kill, and looks after a running shift the
     * tracker is not recording (the phone was off, the service could not restart). One that recorded
     * nothing for [AUTO_CLOSE_AFTER_MS] is ended at its last qualified fix, never "now" (14 section
     * 7.4, flag `shift_auto_closed`); otherwise recording is started again.
     */
    suspend fun recover(): Recovery {
        val shift = store.runningShift() ?: return Recovery.NONE
        if (shift.endedAt != null) {
            lock.withLock { handOff(shift) }
            return Recovery.FINISHED_END
        }
        if (recorder.recording() == shift.clientId) return Recovery.RECORDING
        val fixes = store.fixes.fixesFor(shift.clientId)
        val lastAt = maxOf(shift.startedAt, fixes.maxOfOrNull { it.recordedAt } ?: shift.startedAt)
        if (clock.nowMs() - lastAt >= AUTO_CLOSE_AFTER_MS) {
            closeUnfinished()
            return Recovery.AUTO_CLOSED
        }
        val tracking = context()?.tracking ?: true
        if (!tracking) return Recovery.RECORDING
        return if (recorder.start(shift.clientId, shift.startedAt)) Recovery.RESUMED else Recovery.NOT_RECORDING
    }

    /** Ends the running shift at its last qualified fix (or its start without one), flagged auto-closed. */
    suspend fun closeUnfinished(): EndResult {
        val shift = running() ?: return EndResult.NoShift
        val end = ShiftRun.autoCloseEnd(shift.startedAt, store.fixes.fixesFor(shift.clientId))
        return endAt(end, null, autoClosed = true)
    }

    // ------------------------------------------------------------------------------------------
    // Driver edits (15 section 8.1): written at once (they show offline) and queued with their edit
    // time; the server decides by last writer wins and the change log brings its answer. The
    // distance of an automatic trip is never editable (07 section 3 rule 8); a finalized shift is
    // not editable (409 on the server). The phone never deletes server data.

    /** Edit times carry the GNSS offset when a fresh fix exists (15 section 10). */
    private fun stamp(): Long = clock.nowMs() + (recorder.gnssOffsetMs() ?: 0)

    private suspend fun editable(clientId: String): Pair<ShiftRecord?, EditResult.Reason?> {
        val s = store.shift(clientId) ?: return null to EditResult.Reason.NO_SHIFT
        if (s.status == ShiftStatus.FINALIZED) return s to EditResult.Reason.FINALIZED
        return s to null
    }

    /** Reclassifies a trip (active, deadhead, personal) or changes its purpose. */
    suspend fun editTrip(tripKey: String, kind: TripKind? = null, purpose: String? = null): EditResult {
        val trip = store.trip(tripKey) ?: return EditResult.Refused(EditResult.Reason.NO_TRIP)
        val (shift, bad) = editable(trip.shiftClientId)
        if (bad != null) return EditResult.Refused(bad)
        val p = purposeOf(purpose ?: trip.purpose) ?: return EditResult.Refused(EditResult.Reason.INVALID)
        val k = kind ?: trip.kind
        val at = stamp()
        store.transaction {
            store.upsertTrip(trip.copy(kind = k, purpose = p, editedAt = at, sendState = SendState.ON_PHONE_ONLY))
            if (trip.source == TripSource.MANUAL) {
                outbox.enqueue(ShiftChange.ManualTrip(trip.shiftClientId, trip.tripKey, k, trip.startedAt, trip.endedAt, trip.distanceM, p, at))
            } else {
                outbox.enqueue(ShiftChange.Override(trip.tripKey, k, p, at))
            }
            move(requireNotNull(shift), trip.kind, k, trip.distanceM)
        }
        onQueued()
        return EditResult.Ok
    }

    /**
     * Adds a manual trip. Without a purpose it gets [MANUAL_TRIP_PURPOSE]: the phone's form has no
     * purpose field, and the server refuses an empty one (TripCreate.purpose is 1 to 200 characters;
     * before the AR5 fix every phone-added trip was parked for it).
     */
    suspend fun addManualTrip(
        clientId: String,
        kind: TripKind,
        startedAt: Long,
        endedAt: Long,
        distanceM: Long,
        purpose: String? = null,
    ): EditResult {
        val (shift, bad) = editable(clientId)
        if (bad != null) return EditResult.Refused(bad)
        if (shift!!.running) return EditResult.Refused(EditResult.Reason.RUNNING)
        val p = purposeOf(purpose ?: MANUAL_TRIP_PURPOSE)
        if (distanceM <= 0 || endedAt < startedAt || p == null) return EditResult.Refused(EditResult.Reason.INVALID)
        val key = newId().lowercase()
        val at = stamp()
        store.transaction {
            store.upsertTrip(
                TripRecord(
                    tripKey = key,
                    shiftClientId = clientId,
                    kind = kind,
                    originalKind = if (kind == TripKind.DEADHEAD) TripKind.DEADHEAD else TripKind.ACTIVE,
                    source = TripSource.MANUAL,
                    startedAt = startedAt,
                    endedAt = endedAt,
                    distanceM = distanceM,
                    purpose = p,
                    editedAt = at,
                ),
            )
            outbox.enqueue(ShiftChange.ManualTrip(clientId, key, kind, startedAt, endedAt, distanceM, p, at))
            move(shift, null, kind, distanceM)
        }
        onQueued()
        return EditResult.Ok
    }

    /** Corrects an odometer reading (whole metres). */
    suspend fun setOdometer(clientId: String, kind: OdometerKind, readingM: Long): EditResult {
        val (_, bad) = editable(clientId)
        if (bad != null) return EditResult.Refused(bad)
        if (readingM < 0) return EditResult.Refused(EditResult.Reason.INVALID)
        val at = stamp()
        store.transaction {
            store.upsertOdometer(OdometerRecord(clientId, kind, readingM, at))
            outbox.enqueue(ShiftChange.Odometer(clientId, kind.toApi(), readingM.toDouble(), at))
        }
        onQueued()
        return EditResult.Ok
    }

    /** Changes the shift's notes (at most 1,000 characters). */
    suspend fun setNotes(clientId: String, notes: String): EditResult {
        val (shift, bad) = editable(clientId)
        if (bad != null) return EditResult.Refused(bad)
        if (notes.length > 1000) return EditResult.Refused(EditResult.Reason.INVALID)
        val at = stamp()
        store.transaction {
            store.upsertShift(shift!!.copy(notes = notes, updatedAt = at))
            outbox.enqueue(ShiftChange.Patch(clientId, notes, at))
        }
        onQueued()
        return EditResult.Ok
    }

    /**
     * Moves [distanceM] between the buckets ([from] null: a new trip). Only the difference is
     * applied, so the engine's own rounding stays; the server's numbers replace these from the
     * change log. A shift without totals is left alone.
     */
    private suspend fun move(shift: ShiftRecord, from: TripKind?, to: TripKind, distanceM: Long) {
        val cur = store.shift(shift.clientId) ?: return
        val d = cur.distances ?: return
        var active = d.activeM
        var deadhead = d.deadheadM
        var personal = d.personalM
        fun add(k: TripKind, m: Long) = when (k) {
            TripKind.ACTIVE -> active += m
            TripKind.DEADHEAD -> deadhead += m
            TripKind.PERSONAL -> personal += m
        }
        if (from != null) add(from, -distanceM)
        add(to, distanceM)
        store.upsertShift(cur.copy(distances = Distances(d.totalM + if (from == null) distanceM else 0, active, deadhead, personal)))
    }

    // ------------------------------------------------------------------------------------------
    // The notification buttons (`ShiftCommands` of :core tracking): "Start" on the drive prompt and
    // "End shift". The app wires these into `trackingDependencies(shiftCommands = model.commands)`.

    val commands: ShiftCommands = object : ShiftCommands {
        override suspend fun startDetectedShift(startedAt: Long): CommandOutcome {
            val vehicle = lastVehicleId() ?: store.vehicles().firstOrNull { it.archivedAt == null }?.id
                ?: return CommandOutcome.OPEN_APP
            return when (start(vehicle, null, startedAt)) {
                is StartResult.Started, is StartResult.AlreadyRunning -> CommandOutcome.DONE
                StartResult.NotPaired, StartResult.RecorderRefused -> CommandOutcome.OPEN_APP
            }
        }

        override suspend fun endShift(): CommandOutcome {
            end()
            return CommandOutcome.DONE
        }
    }

    private suspend fun readBattery(): BatteryReading? = try {
        battery?.read()?.takeIf { it.level in 0..100 }
    } catch (e: CancellationException) {
        throw e
    } catch (_: RuntimeException) {
        null
    }

    companion object {
        /** The purpose of a trip added on the phone, which has no purpose field (the web asks for one). */
        const val MANUAL_TRIP_PURPOSE = "Business driving"

        /** A running shift that recorded nothing this long while the tracker was not running is ended at its last fix. */
        const val AUTO_CLOSE_AFTER_MS = 12 * 60 * 60_000L

        const val K_LAST_VEHICLE = "shift.lastVehicle"

        /**
         * A purpose as the server takes it (`TripCreate.purpose`, `TripOverridePut.purpose`: 1 to
         * 200 characters), trimmed as the web's form does; null when it would be refused.
         */
        fun purposeOf(text: String): String? = text.trim().takeIf { it.length in 1..200 }

        fun tripsOf(shift: ShiftRecord, r: ShiftResult): List<TripRecord> = r.trips.map { t ->
            TripRecord(
                tripKey = t.tripKey,
                shiftClientId = shift.clientId,
                kind = ShiftRun.kindOf(t.kind),
                originalKind = ShiftRun.kindOf(t.originalKind.asKind),
                source = TripSource.AUTO,
                startedAt = t.startedAt,
                endedAt = t.endedAt,
                startLatE7 = t.startLatE7.toLong(),
                startLonE7 = t.startLonE7.toLong(),
                endLatE7 = t.endLatE7.toLong(),
                endLonE7 = t.endLonE7.toLong(),
                distanceM = t.distanceM,
                purpose = t.purpose,
            )
        }

        /** Stops only with stop detection on (the whole-shift segmenter has none to show). */
        fun stopsOf(shift: ShiftRecord, r: ShiftResult): List<StopRecord> =
            if (shift.segmenter != app.milewage.core.api.Segmenter.STOPS) {
                emptyList()
            } else {
                r.stops.map { s ->
                    StopRecord(s.stopKey, shift.clientId, s.startedAt, s.endedAt, s.dwellS, s.latE7.toLong(), s.lonE7.toLong(), s.confidence.wire, s.estRole.wire, s.role.wire)
                }
            }

        fun routeOf(r: ShiftResult): List<RoutePoint> = r.route.map { RoutePoint(it.latE7.toLong(), it.lonE7.toLong(), it.t) }

        /** The flags a result carries, for screens. */
        fun flagCodes(flags: List<Flag>): List<String> = flags.map { it.code.wire }
    }
}

/** A version 4 UUID, lower case (the shift's and a manual trip's client id). */
@OptIn(ExperimentalUuidApi::class)
fun newClientId(): String = Uuid.random().toString()
