package app.milewage.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import app.milewage.core.api.Api
import app.milewage.core.api.ApiException
import app.milewage.core.api.MileageRate
import app.milewage.core.api.Settings
import app.milewage.core.api.TripKind
import app.milewage.core.connect.ServerIdentity
import app.milewage.core.demo.Demo
import app.milewage.core.demo.DemoSamples
import app.milewage.core.demo.DemoServer
import app.milewage.core.diagnostics.PermSnapshot
import app.milewage.core.diagnostics.PhoneDiagnostics
import app.milewage.core.pairing.Flags
import app.milewage.core.pairing.Pairing
import app.milewage.core.pairing.PairingLink
import app.milewage.core.ports.Clock
import app.milewage.core.shift.BatteryPort
import app.milewage.core.shift.EditResult
import app.milewage.core.shift.EndResult
import app.milewage.core.shift.HomeSummary
import app.milewage.core.shift.LiveTotals
import app.milewage.core.shift.MileageRates
import app.milewage.core.shift.OdometerDue
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.OdometerRecord
import app.milewage.core.shift.OverwriteEntry
import app.milewage.core.shift.Recorder
import app.milewage.core.shift.Recovery
import app.milewage.core.shift.RoutePoint
import app.milewage.core.shift.ShiftContext
import app.milewage.core.shift.ShiftEndListener
import app.milewage.core.shift.ShiftModel
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.StartResult
import app.milewage.core.shift.StopRecord
import app.milewage.core.shift.Summaries
import app.milewage.core.shift.TripRecord
import app.milewage.core.shift.VehicleRecord
import app.milewage.core.shift.newClientId
import app.milewage.core.sync.ChangePuller
import app.milewage.core.sync.OtherServerShifts
import app.milewage.core.sync.Outbox
import app.milewage.core.sync.ReminderPort
import app.milewage.core.sync.RestoreCheck
import app.milewage.core.sync.SendStatus
import app.milewage.core.sync.Sender
import app.milewage.core.sync.ServerBinding
import app.milewage.core.sync.ShiftMarker
import app.milewage.core.sync.UnsyncedReminders
import app.milewage.core.tracking.FixStore
import app.milewage.core.tracking.Interruption
import app.milewage.core.tracking.InterruptionLog
import app.milewage.core.tracking.InterruptionReason
import app.milewage.core.tracking.ShiftCommands
import app.milewage.core.tracking.TrackingDiagnostics
import app.milewage.data.db.MileWageDatabase
import app.milewage.data.db.RoomLocalStore
import app.milewage.data.net.OkHttpTransport
import app.milewage.data.pairing.ServerConnection
import app.milewage.data.sync.SendScheduler
import app.milewage.data.sync.WorkSendScheduler
import app.milewage.engine.Engine
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.transform
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** The running shift for the home screen and the shift notification's details. */
data class RunningShiftView(
    val shift: ShiftRecord,
    /** Metres from the stored fixes (the engine's live accumulator); the end's run is the authority. */
    val distanceM: Long,
    /** Its deduction value so far in cents, after the month's earlier shifts; null: no rate. */
    val deductionSoFarCents: Long?,
    val vehicle: VehicleRecord?,
    /** The server holds another running shift: this one keeps recording, its create waits. */
    val serverHasOtherShift: Boolean,
)

/** One row of the shifts list. */
data class ShiftListItem(val shift: ShiftRecord, val marker: ShiftMarker, val vehicle: VehicleRecord?)

/** Everything the shift detail screen shows. */
data class ShiftDetail(
    val shift: ShiftRecord,
    val marker: ShiftMarker,
    val vehicle: VehicleRecord?,
    /** Automatic trips (with trip edits applied) and manual trips, by start time. */
    val trips: List<TripRecord>,
    val stops: List<StopRecord>,
    /** The simplified route for the map; empty when there is none. */
    val route: List<RoutePoint>,
    val odometer: List<OdometerRecord>,
    val interruptions: List<Interruption>,
    /** Unseen entries of the overwrite log (a Difference, an edit the server's newer one replaced). */
    val overwrites: List<OverwriteEntry>,
)

/** The vehicles to start a shift with. [offline]: the server could not be reached; the kept copy. */
data class VehicleList(val vehicles: List<VehicleRecord>, val offline: Boolean)

/** What a background run did, for the worker's result. */
enum class BackgroundResult {
    /** Nothing is left on the phone only. */
    DONE,

    /** Something waits and the server could not be reached: try again later. */
    RETRY,

    /** Something waits that only the driver can unblock (re-pair, a refused change): do not retry. */
    BLOCKED,
}

/** Implemented by the Application, so the worker finds the one [MileWageData]. */
interface MileWageDataProvider {
    val mileWageData: MileWageData
}

/**
 * The app's one entry to its data (one per process, made by the Application): the database, the
 * server connection, the shift model, sending, the change log, diagnostics and the reminder logic.
 * The screens read [Flow]s (they update whenever the tables they read change) and call suspend
 * functions; every write is committed before the call returns. The tracking module gets [fixStore],
 * [shiftCommands], [trackingDiagnostics] (and [interruptionLog] if it keeps interruptions here).
 *
 * Build it with [create] on the phone; tests use [assemble] with their own database and pairing.
 */
class MileWageData private constructor(
    private val db: MileWageDatabase,
    val store: RoomLocalStore,
    /** Pairing, status, unpair (with [hasUnsentData]), the device session's halts. */
    val pairing: Pairing,
    /**
     * Which server each shift belongs to (see `ServerBinding` in :core): sending, the unsent counts,
     * the restore check and the unpair check see only the paired server's shifts.
     */
    val binding: ServerBinding,
    private val restore: RestoreCheck,
    private val recorder: Recorder,
    private val scheduler: SendScheduler,
    private val scope: CoroutineScope,
    private val clock: Clock,
    appVersion: String,
    reminderPort: ReminderPort?,
    battery: BatteryPort?,
    private val freeBytes: suspend () -> Long?,
    private val databaseBytes: () -> Long,
    private val permissions: (suspend () -> PermSnapshot?)?,
    gzipSize: (ByteArray) -> Long?,
    private val engine: CoroutineDispatcher,
    newId: () -> String,
    rand: () -> Double,
) {
    /** The queue as sending reads it: the paired server's rows (writes go to any shift's queue). */
    private val outbox = Outbox(binding.view, clock)

    val diagnostics = PhoneDiagnostics(
        store, store, appVersion, clock,
        fixesPending = { binding.view.pendingCount() > 0 },
        server = { binding.instance() },
    )

    /** Start, end, recovery, edits. */
    val shifts: ShiftModel = ShiftModel(
        store = store,
        outbox = outbox,
        recorder = recorder,
        // A new shift is bound to the server paired now.
        context = { pairing.load()?.let { ShiftContext.of(Flags.of(it.settings), it.credential.instanceId) } },
        clock = clock,
        newId = newId,
        battery = battery,
        engine = engine,
        onQueued = { changed() },
        onEnded = ShiftEndListener { shift, run, ms ->
            val restarts = store.interruptions(shift.clientId).count { it.reason == InterruptionReason.SERVICE_RESTARTED }
            diagnostics.recordShiftEnd(shift, run, ms, restarts)
        },
    )

    /** Sending: status, "Send now", the loop. */
    val sender: Sender = Sender(
        store = binding.view,
        outbox = outbox,
        session = binding.guard { pairing.session() },
        device = pairing.device,
        restore = restore,
        handshake = { pairing.load()?.let { pairing.refreshSettings(it) } },
        onSettings = { pairing.storeSettings(it) },
        phoneRun = { shifts.phoneRun(it) },
        freeBytes = freeBytes,
        clock = clock,
        rand = rand,
        binding = binding,
        gzipSize = gzipSize,
    )

    private val reminders = reminderPort?.let { UnsyncedReminders(it, store, clock) }
    private val live = LiveTotals { id, after, limit -> store.after(id, after, limit) }
    private val liveLock = Mutex()

    /** The tracker's points table (`trackingDependencies(fixStore = ...)`). */
    val fixStore: FixStore get() = store.fixes

    /** The notification buttons (`trackingDependencies(shiftCommands = ...)`). */
    val shiftCommands: ShiftCommands get() = shifts.commands

    /** The tracker's events into the diagnostics ring (`trackingDependencies(diagnostics = ...)`). */
    val trackingDiagnostics: TrackingDiagnostics = diagnostics.trackingSink(scope)

    /** Interruptions in the database, for a tracker that keeps them here instead of its preferences. */
    val interruptionLog: InterruptionLog get() = store.interruptionLog

    private fun changed() {
        sender.kick()
        scheduler.kick()
    }

    init {
        // Every pairing change (a code, a link, unpaired, a halt lifted): the paired server is read
        // again, unbound shifts are claimed for it and its host name is kept for the screens.
        pairing.subscribe {
            binding.invalidate()
            scope.launch { runCatching { binding.settle() } }
        }
    }

    // ------------------------------------------------------------------------------------------
    // Lifecycle

    private var started = false

    /**
     * Call once from `Application.onCreate` (cheap; the work runs in [scope]): finishes an end cut
     * short by a kill, looks after a running shift the tracker lost (resumes it, or auto-closes one
     * silent for 12 hours), records `app.start`, starts the sending loop and the periodic worker.
     */
    fun start(device: DeviceInfo) {
        if (started) return
        started = true
        scheduler.ensurePeriodic()
        scope.launch {
            runCatching { binding.settle() }
            runCatching { shifts.recover() }
            runCatching { diagnostics.recordAppStart(Engine.ALGORITHM_VERSION.toString(), device.make, device.model, device.android, device.sdk) }
            sender.start(scope)
            launch { diagnosticsLoop() }
        }
    }

    /** The app came to the foreground, the network came back, or the driver opened a screen that shows sending. */
    fun kick() = sender.kick()

    /** The worker's body: one round, then the reminders and the diagnostics window. */
    suspend fun runInBackground(): BackgroundResult {
        runCatching { shifts.recover() }
        val done = sender.sendNow()
        updateReminders()
        runCatching { diagnosticsWindow() }
        if (done) return BackgroundResult.DONE
        val s = sender.status().sync
        return if (s.halt != null || sender.outbox.counts().parked > 0) BackgroundResult.BLOCKED else BackgroundResult.RETRY
    }

    private suspend fun diagnosticsLoop() {
        while (scope.isActive) {
            delay(DIAG_WINDOW_MS)
            runCatching { diagnosticsWindow() }
            runCatching { updateReminders() }
        }
    }

    /**
     * Closes a 10-minute window: `upload.window` and `diag.self`, the permissions, storage and
     * connection states when they changed, then sends the ring to the server it was recorded for.
     */
    suspend fun diagnosticsWindow() {
        val view = binding.view
        val pending = view.pendingCount()
        val oldest = view.oldestPendingAt()?.let { maxOf(0, (clock.nowMs() - it) / 1000) } ?: 0
        diagnostics.recordUploadWindow(sender.takeUploadStats(), pending, oldest)
        permissions?.let { read -> runCatching { read() }.getOrNull()?.let { diagnostics.recordPermissions(it) } }
        val status = sender.status().sync
        diagnostics.recordStorage(freeBytes(), databaseBytes(), status.unsentShifts, pending, store.setAsideCount())
        if (sender.hasRun && pairing.load() != null) {
            diagnostics.recordSyncState(PhoneDiagnostics.syncStateOf(status.halt, sender.restoring(), sender.lastRoundState))
        }
        diagnostics.recordSelf()
        pairing.session()?.let { diagnostics.flush(it.client, it.credential.instanceId) }
    }

    /** Keeps the unsynced reminder (3 days, then daily) in step with what waits. */
    suspend fun updateReminders() {
        val r = reminders ?: return
        val s = sender.status().sync
        r.update(s.oldestAt, s.unsentShifts)
    }

    /** The home banner showed the reminder (it counts as given for the day). */
    suspend fun reminderShownOnBanner() = reminders?.bannerShown()

    // ------------------------------------------------------------------------------------------
    // What the screens read

    /**
     * What a screen shows, read again when one of [tables] or the sender's state changes. The read
     * never runs on the caller's thread (a screen collects on the main thread, and a read opens the
     * credential, decodes the settings and adds up shifts). While the phone sends, the tables change
     * with every batch: changes that arrive during a read are folded into one, and reads keep
     * [WATCH_GAP_MS] apart, so a round costs a few reads a second and the screen stays smooth.
     */
    private fun <T> watch(vararg tables: String, read: suspend () -> T): Flow<T> =
        merge<Any>(db.invalidationTracker.createFlow(*tables), sender.changes)
            .onStart { emit(Unit) }
            .conflate()
            .transform {
                emit(read())
                delay(WATCH_GAP_MS)
            }
            .distinctUntilChanged()
            .flowOn(engine)

    /** Day, week and month totals and deduction values, unsent shifts counted (15 section 4). */
    fun homeSummary(): Flow<HomeSummary> = watch("shifts", "vehicles") { summaryNow() }

    suspend fun summaryNow(): HomeSummary {
        val settings = pairing.load()?.settings
        val tz = settings?.timezone ?: "UTC"
        val today = Summaries.today(clock.nowMs(), tz)
        val rows = store.shiftsFrom(minOf(Summaries.weekStart(today, settings?.weekStart ?: 1), "${today.take(7)}-01"))
        return Summaries.summarize(rows, today, ratesOf(settings), kinds(), settings?.weekStart ?: 1)
    }

    /** The running shift with its live distance and deduction so far; null when none runs. */
    fun runningShift(): Flow<RunningShiftView?> = watch("shifts", "fixes", "vehicles") { runningNow() }

    suspend fun runningNow(): RunningShiftView? {
        val s = shifts.running() ?: return null
        val distance = liveLock.withLock { live.distanceM(s) }
        val settings = pairing.load()?.settings
        val month = store.shiftsFrom("${s.localDate.take(7)}-01")
        val value = Summaries.runningValue(month, s, distance, ratesOf(settings), kinds())
        return RunningShiftView(s, distance, value, store.vehicles().firstOrNull { it.id == s.vehicleId }, s.serverHasOtherShift)
    }

    /** Newest first. A shift still waiting for another server is marked so ([ShiftMarker.OTHER_SERVER]). */
    fun shiftList(limit: Int = 200): Flow<List<ShiftListItem>> = watch("shifts", "vehicles") {
        val v = store.vehicles().associateBy { it.id }
        val paired = binding.instance()
        store.shifts(limit).map { ShiftListItem(it, ShiftMarker.of(it, paired), v[it.vehicleId]) }
    }

    fun shiftDetail(clientId: String): Flow<ShiftDetail?> =
        watch("shifts", "trips", "stops", "routes", "odometer_readings", "interruptions", "overwrite_log", "vehicles") { detailNow(clientId) }

    suspend fun detailNow(clientId: String): ShiftDetail? {
        val s = store.shift(clientId) ?: return null
        return ShiftDetail(
            shift = s,
            marker = binding.markerOf(s),
            vehicle = store.vehicles().firstOrNull { it.id == s.vehicleId },
            trips = store.trips(clientId),
            stops = store.stops(clientId),
            route = store.route(clientId),
            odometer = store.odometer(clientId),
            interruptions = store.interruptions(clientId),
            overwrites = store.overwrites(clientId),
        )
    }

    /** The banner: colour, counts, sentence, halt and the round's progress. */
    fun syncStatus(): Flow<SendStatus> = watch("shifts", "fixes", "outbox", "resend_marks") { sender.status() }

    fun vehicles(): Flow<List<VehicleRecord>> = watch("vehicles") { store.vehicles() }

    /**
     * Shifts recorded for another server and never sent there: how many, their fixes, that server's
     * host name. They go only to that server; the driver connects to it again or deletes them.
     */
    fun otherServer(): Flow<OtherServerShifts> = watch("shifts", "fixes", "outbox", "bookkeeping") { otherServerNow() }

    suspend fun otherServerNow(): OtherServerShifts = off { binding.elsewhere() }

    // ------------------------------------------------------------------------------------------
    // What the screens do

    suspend fun startShift(vehicleId: Long, odometerStartM: Long? = null): StartResult = shifts.start(vehicleId, odometerStartM)

    suspend fun endShift(odometerEndM: Long? = null): EndResult = shifts.end(odometerEndM)

    /** "End it at its last fix" for a running shift the tracker lost. */
    suspend fun closeUnfinished(): EndResult = off { shifts.closeUnfinished() }

    suspend fun setOdometerStart(readingM: Long): EditResult = off { shifts.setOdometerStart(readingM) }

    suspend fun editTrip(tripKey: String, kind: TripKind? = null, purpose: String? = null): EditResult = off { shifts.editTrip(tripKey, kind, purpose) }

    suspend fun addManualTrip(clientId: String, kind: TripKind, startedAt: Long, endedAt: Long, distanceM: Long, purpose: String? = null): EditResult =
        off { shifts.addManualTrip(clientId, kind, startedAt, endedAt, distanceM, purpose) }

    suspend fun setOdometer(clientId: String, kind: OdometerKind, readingM: Long): EditResult = off { shifts.setOdometer(clientId, kind, readingM) }

    suspend fun setNotes(clientId: String, notes: String): EditResult = off { shifts.setNotes(clientId, notes) }

    suspend fun markOverwriteSeen(id: Long) = off { store.markOverwriteSeen(id) }

    /** Whether to ask for the odometer after a shift of this vehicle ends (monthly, or 14 days). */
    suspend fun odometerDue(vehicleId: Long): Boolean = off { OdometerDue.due(clock.nowMs(), pairing.load()?.settings?.timezone ?: "UTC", OdometerDue.lastCheck(store, vehicleId)) }

    /** Answered or dismissed: the prompt stays away until the next one is due. */
    suspend fun markOdometerChecked(vehicleId: Long) = off { OdometerDue.markChecked(store, vehicleId, clock.nowMs()) }

    /** The last vehicle used, to preselect it. */
    suspend fun lastVehicleId(): Long? = off { shifts.lastVehicleId() }

    /**
     * The vehicles from the server (`GET /vehicles`), kept, so a shift can be started offline; the
     * kept copy when the server cannot be reached.
     */
    suspend fun refreshVehicles(): VehicleList = off {
        val s = pairing.session() ?: return@off VehicleList(store.vehicles(), offline = true)
        try {
            val list = s.client.call(Api.vehicles).data
            store.transaction {
                val keep = list.map { it.id }.toSet()
                for (old in store.vehicles()) if (old.id !in keep) store.deleteVehicle(old.id)
                for (v in list) store.upsertVehicle(ChangePuller.vehicleOf(v))
            }
            VehicleList(store.vehicles(), offline = false)
        } catch (_: ApiException) {
            VehicleList(store.vehicles(), offline = true)
        }
    }

    /** One round now (also lifts nothing). True when nothing is left on the phone only. */
    suspend fun sendNow(): Boolean = off { sender.sendNow(force = true) }

    /** "Send now" / "Check the address": lifts the halts and refusals, then a round. */
    suspend fun retrySending(): Boolean = off { sender.retry() }

    fun cancelSending() = sender.cancel()

    /** True while anything for the paired server is on the phone only (asks before unpairing, decision 1.5d). */
    suspend fun hasUnsentData(): Boolean = off { sender.hasUnsentData() }

    /**
     * Unpairs; refused (false) while the paired server's data waits, unless [confirmed] after the
     * driver read that it stays on this phone. Nothing is deleted either way: what was not sent stays
     * bound to this server and goes there when the phone is paired with it again.
     */
    suspend fun unpair(confirmed: Boolean = false): Boolean = off { pairing.unpair { !confirmed && hasUnsentData() } }

    /**
     * Deletes the shifts [otherServer] lists (recorded for another server, never sent there) with
     * everything of them, after the driver confirmed. A running shift is kept. Returns how many.
     */
    suspend fun deleteOtherServerShifts(): Int = off { binding.deleteElsewhere() }

    // ------------------------------------------------------------------------------------------
    // Demo mode ("Try it without a server", see `Demo` in :core)

    /** True while the phone is paired with the demo server in this process. */
    suspend fun isDemo(): Boolean = Demo.isDemo(pairing.load()?.credential)

    /** [isDemo] now and after every pairing change. */
    fun demo(): Flow<Boolean> = pairing.statusFlow().map { isDemo() }.distinctUntilChanged()

    /**
     * Pairs with the demo server and writes its sample vehicles and shifts. The setup steps follow
     * as after any first connection. Nothing goes over the network: the demo server is in-process.
     */
    suspend fun enterDemo() = off {
        store.put(Demo.KEY_SINCE, clock.nowMs().toString())
        pairing.redeem(Demo.LINK)
        DemoSamples.seed(store, clock.nowMs())
        kick()
    }

    /**
     * "Leave demo": ends a demo shift that is still running (the tracker stops), unpairs and deletes
     * everything the demo added; the gate then shows first run. False when not in demo mode.
     */
    suspend fun leaveDemo(): Boolean = off {
        if (!isDemo()) return@off false
        shifts.running()?.let { shifts.end(null) }
        pairing.unpair { false }
        clearDemo()
        true
    }

    /**
     * Connects to a server with a pairing code. From demo mode the demo's data is deleted first, so
     * nothing of the demo is ever sent to a real server.
     */
    suspend fun connect(link: PairingLink) {
        if (isDemo()) leaveDemo()
        pairing.redeem(link)
        kick()
    }

    /**
     * Deletes what is bound to the demo server: the sample shifts and those recorded in demo mode
     * with all of theirs, the sample vehicles and the demo's bookkeeping. A shift the demo pairing
     * claimed from before (recorded unbound) is given back unbound, never deleted.
     */
    private suspend fun clearDemo() {
        val since = store.get(Demo.KEY_SINCE)?.toLongOrNull() ?: 0L
        store.transaction {
            for (s in store.shifts(Int.MAX_VALUE)) {
                if (s.instanceId != Demo.INSTANCE) continue
                if (s.clientId.startsWith(Demo.SAMPLE_PREFIX) || s.startedAt >= since) {
                    store.dropChanges(s.clientId)
                    store.deleteShift(s.clientId)
                } else {
                    store.upsertShift(s.copy(instanceId = null))
                }
            }
            for (v in store.vehicles()) if (v.id in Demo.VEHICLE_IDS) store.deleteVehicle(v.id)
            for (k in ServerBinding.PER_SERVER_KEYS) store.remove(ServerBinding.keyFor(k, Demo.INSTANCE))
            store.remove(Demo.KEY_SINCE)
        }
        binding.invalidate()
    }

    /**
     * Main-safe (Android's rule for a data layer): what a screen asks for is done on [engine], never
     * on the thread that asked. A screen calls from the main thread, and a round of sending encodes,
     * compresses and decodes there otherwise, which is what made the app stutter while it sent.
     */
    private suspend fun <T> off(block: suspend () -> T): T = withContext(engine) { block() }

    private suspend fun kinds(): Map<Long, String> = store.vehicles().associate { it.id to it.kind }

    companion object {
        const val DIAG_WINDOW_MS = 10 * 60_000L

        /** The least time between two reads of one watched value (see `watch`). */
        const val WATCH_GAP_MS = 150L

        /**
         * Free space for the app's files, counting cache Android can clear for it (15 section 3.4);
         * null when it cannot be read (the banner shows "unknown", never "normal").
         */
        fun freeBytes(context: Context): Long? = runCatching {
            val sm = context.getSystemService(android.os.storage.StorageManager::class.java)
            sm.getAllocatableBytes(sm.getUuidForPath(context.filesDir))
        }.getOrNull()

        /** The database file with its write-ahead log, in bytes (`storage.state`). */
        fun databaseBytes(context: Context): Long = runCatching {
            val f = context.getDatabasePath(MileWageDatabase.FILE_NAME)
            listOf(f, java.io.File(f.path + "-wal")).sumOf { if (it.exists()) it.length() else 0L }
        }.getOrDefault(0L)

        /** The driver's own rate where the settings choose it; the country packs are not on the phone yet. */
        fun ratesOf(s: Settings?): MileageRates {
            val own = s?.ownMileageRate ?: return MileageRates.None
            val step = own.step?.let { MileageRates.Step(it.thresholdUnits, it.centsPerUnitAfter, it.periodStart, it.drivenM) }
            return if (s.mileageRate == MileageRate.YOURS || s.mileageRate == null) MileageRates.OwnRate(own.centsPerUnit, own.unit, step) else MileageRates.None
        }

        /**
         * Assembles the graph from its edges. [connect] builds the [Pairing] with the two hooks this
         * object needs: every answer of the paired server (the restore-generation check) and the
         * settings whenever they are stored (the diagnostics level).
         */
        fun assemble(
            db: MileWageDatabase,
            connect: (onAnswer: suspend (ServerIdentity, String?) -> Unit, onSettings: suspend (Settings) -> Unit) -> Pairing,
            recorder: Recorder,
            scheduler: SendScheduler,
            scope: CoroutineScope,
            clock: Clock,
            appVersion: String,
            reminders: ReminderPort? = null,
            battery: BatteryPort? = null,
            freeBytes: suspend () -> Long? = { null },
            engine: CoroutineDispatcher = Dispatchers.Default,
            newId: () -> String = ::newClientId,
            rand: () -> Double = { kotlin.random.Random.nextDouble() },
            databaseBytes: () -> Long = { 0 },
            permissions: (suspend () -> PermSnapshot?)? = null,
            gzipSize: (ByteArray) -> Long? = OkHttpTransport::gzipSize,
        ): MileWageData {
            val store = RoomLocalStore(db)
            var paired: Pairing? = null
            val binding = ServerBinding(store) { paired?.load()?.credential }
            // The restore check sees the paired server's shifts and keeps its generation per server.
            val restore = RestoreCheck(binding.view)
            var self: MileWageData? = null
            val pairing = connect(
                { identity, expected -> restore.observe(identity, expected) },
                { settings -> self?.diagnostics?.applySettings(settings) },
            )
            paired = pairing
            return MileWageData(
                db, store, pairing, binding, restore, recorder, scheduler, scope, clock, appVersion, reminders, battery, freeBytes,
                databaseBytes, permissions, gzipSize, engine, newId, rand,
            ).also { self = it }
        }

        /**
         * The phone's graph: the database file, the server connection (home or away for every
         * request), WorkManager for background sending, and a network callback that wakes sending
         * when a network comes back. [recorder] is the app's adapter over `TrackingController`.
         */
        fun create(
            context: Context,
            anyHttp: Boolean,
            appVersion: String,
            scope: CoroutineScope,
            recorder: Recorder,
            reminders: ReminderPort? = null,
            battery: BatteryPort? = null,
            /** The phone's permissions for `perm.state` (the app reads them from the tracker); null: not recorded. */
            permissions: (suspend () -> PermSnapshot?)? = null,
        ): MileWageData {
            val app = context.applicationContext
            var connection: ServerConnection? = null
            var self: MileWageData? = null
            val clock = Clock { System.currentTimeMillis() }
            // The demo server answers from the phone's own records (it keeps nothing itself).
            val demo = DemoServer(clock) { id -> self?.store?.shift(id) }
            val data = assemble(
                db = MileWageDatabase.open(app),
                connect = { onAnswer, onSettings ->
                    ServerConnection(app, anyHttp, appVersion, clock, onSettings = onSettings, onAnswer = onAnswer, demo = demo)
                        .also { connection = it }.pairing
                },
                recorder = recorder,
                scheduler = WorkSendScheduler(app),
                scope = scope,
                clock = clock,
                appVersion = appVersion,
                reminders = reminders,
                battery = battery,
                freeBytes = { freeBytes(app) },
                databaseBytes = { databaseBytes(app) },
                permissions = permissions,
            )
            data.connection = connection
            self = data
            runCatching {
                app.getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(
                    object : ConnectivityManager.NetworkCallback() {
                        override fun onAvailable(network: Network) = data.kick()
                    },
                )
            }
            return data
        }
    }

    /** The server connection (home/away route, Tailscale) on the phone; null in tests. */
    var connection: ServerConnection? = null
        private set
}

/** The phone, for `app.start` (16 section 3.2): `Build.MANUFACTURER`, `Build.MODEL`, `Build.VERSION.RELEASE`, `SDK_INT`. */
data class DeviceInfo(val make: String, val model: String, val android: String, val sdk: Int)
