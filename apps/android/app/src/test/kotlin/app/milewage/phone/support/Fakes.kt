package app.milewage.phone.support

import app.milewage.core.api.Segmenter
import app.milewage.core.api.TripKind
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.shift.CalcSource
import app.milewage.core.shift.Distances
import app.milewage.core.shift.EditResult
import app.milewage.core.shift.EndResult
import app.milewage.core.shift.HomeSummary
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.OdometerRecord
import app.milewage.core.shift.PeriodSummary
import app.milewage.core.shift.RoutePoint
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.ShiftStatus
import app.milewage.core.shift.StartResult
import app.milewage.core.shift.StopRecord
import app.milewage.core.shift.TripRecord
import app.milewage.core.shift.TripSource
import app.milewage.core.shift.VehicleRecord
import app.milewage.core.sync.OtherServerShifts
import app.milewage.core.sync.Progress
import app.milewage.core.sync.SendStatus
import app.milewage.core.sync.ShiftMarker
import app.milewage.core.sync.StatusColor
import app.milewage.core.sync.StatusMessage
import app.milewage.core.sync.SyncStatus
import app.milewage.core.tracking.PowerLevel
import app.milewage.core.tracking.TrackingMode
import app.milewage.core.tracking.TrackingStatus
import app.milewage.data.RunningShiftView
import app.milewage.data.ShiftDetail
import app.milewage.data.ShiftListItem
import app.milewage.data.VehicleList
import app.milewage.phone.model.DisplaySettings
import app.milewage.phone.model.Now
import app.milewage.phone.model.ShiftData
import app.milewage.phone.model.TrackingView
import app.milewage.tracking.TrackingPermissionState
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

/** Tuesday 10 Nov 2026, 14:00 UTC. */
const val NOW = 1_794_319_200_000L
const val HOUR = 3_600_000L

val CIVIC = VehicleRecord(3, "Civic", "car")
val VAN = VehicleRecord(4, "Van", "car")

fun shift(
    id: String = "s1",
    startedAt: Long = NOW - 3 * HOUR,
    endedAt: Long? = NOW - HOUR,
    totalM: Long? = 12_345,
    localDate: String = "2026-11-10",
    sendState: SendState = SendState.ON_PHONE_ONLY,
    calc: CalcSource = CalcSource.PHONE,
    segmenter: Segmenter = Segmenter.STOPS,
    status: ShiftStatus = if (endedAt == null) ShiftStatus.RUNNING else ShiftStatus.ENDED,
    serverId: Long? = null,
) = ShiftRecord(
    clientId = id,
    serverId = serverId,
    vehicleId = 3,
    status = status,
    segmenter = segmenter,
    startedAt = startedAt,
    endedAt = endedAt,
    localDate = localDate,
    distances = totalM?.let { Distances(it, it * 2 / 3, it / 3, 0) },
    calcSource = calc,
    updatedAt = NOW,
    sendState = sendState,
)

fun period(totalM: Long = 42_100, shifts: Int = 3, unsent: Int = 1, cents: Long? = 2_950) =
    PeriodSummary("2026-11-09", "2026-11-10", shifts, unsent, totalM, totalM - 1_000, cents)

val SUMMARY = HomeSummary(period(12_345, 1, 1, 870), period(), period(310_400, 21, 1, 21_730))

fun sendStatus(
    color: StatusColor = StatusColor.GREEN,
    unsentShifts: Int = 0,
    unsentFixes: Long = 0,
    oldestAt: Long? = null,
    message: StatusMessage? = null,
    progress: Progress = Progress(),
) = SendStatus(SyncStatus(color, unsentShifts, unsentFixes, oldestAt, message, null), progress)

val ALLOWED = TrackingPermissionState(
    preciseLocation = true,
    approximateOnly = false,
    backgroundLocation = true,
    notifications = true,
    locationEnabled = true,
    ignoringBatteryOptimizations = true,
)

fun recording(id: String = "run", power: PowerLevel = PowerLevel.FULL) =
    TrackingStatus(mode = TrackingMode.RECORDING, shiftClientId = id, startedAt = NOW - HOUR, power = power)

fun runningView(
    id: String = "run",
    distanceM: Long = 23_400,
    cents: Long? = 1_638,
    serverId: Long? = 7,
    other: Boolean = false,
) = RunningShiftView(
    shift = shift(id, startedAt = NOW - 2 * HOUR - 4 * 60_000 - 9_000, endedAt = null, totalM = null, serverId = serverId),
    distanceM = distanceM,
    deductionSoFarCents = cents,
    vehicle = CIVIC,
    serverHasOtherShift = other,
)

fun detail(
    s: ShiftRecord = shift(),
    trips: List<TripRecord> = listOf(trip("t1", s.clientId, TripKind.ACTIVE, 0), trip("t2", s.clientId, TripKind.DEADHEAD, 1), trip("t3", s.clientId, TripKind.PERSONAL, 2, TripSource.MANUAL)),
    stops: List<StopRecord> = listOf(stop("p1", s.clientId, 0), stop("p2", s.clientId, 1)),
    route: List<RoutePoint> = ROUTE,
    odometer: List<OdometerRecord> = listOf(OdometerRecord(s.clientId, OdometerKind.SHIFT_START, 45_210_000, s.startedAt)),
) = ShiftDetail(s, ShiftMarker.of(s), CIVIC, trips, stops, route, odometer, emptyList(), emptyList())

fun trip(key: String, shift: String, kind: TripKind, i: Int, source: TripSource = TripSource.AUTO) = TripRecord(
    tripKey = key,
    shiftClientId = shift,
    kind = kind,
    originalKind = kind,
    source = source,
    startedAt = NOW - 3 * HOUR + i * 40 * 60_000,
    endedAt = NOW - 3 * HOUR + i * 40 * 60_000 + 30 * 60_000,
    distanceM = 4_100L + i * 1_000,
    purpose = if (kind == TripKind.PERSONAL) "School run" else "Deliveries",
)

fun stop(key: String, shift: String, i: Int) = StopRecord(
    stopKey = key,
    shiftClientId = shift,
    startedAt = NOW - 3 * HOUR + (30 + i * 40) * 60_000,
    endedAt = NOW - 3 * HOUR + (36 + i * 40) * 60_000,
    dwellS = 360,
    latE7 = ROUTE[3 + i * 3].latE7,
    lonE7 = ROUTE[3 + i * 3].lonE7,
    confidence = if (i == 0) "high" else "low",
    estRole = if (i == 0) "pickup" else "none",
    role = "none",
)

/** A small loop through a city (Toronto), degrees x 1e7. */
val ROUTE: List<RoutePoint> = listOf(
    436_532_000L to -793_832_000L, 436_560_000L to -793_800_000L, 436_600_000L to -793_750_000L, 436_650_000L to -793_700_000L,
    436_700_000L to -793_690_000L, 436_740_000L to -793_720_000L, 436_760_000L to -793_780_000L, 436_740_000L to -793_840_000L,
    436_700_000L to -793_870_000L, 436_640_000L to -793_880_000L, 436_580_000L to -793_860_000L,
).mapIndexed { i, (lat, lon) -> RoutePoint(lat, lon, NOW - 3 * HOUR + i * 600_000L) }

/** [ShiftData] in memory: flows the test sets, actions it records. */
class FakeShiftData : ShiftData {
    val summary = MutableStateFlow(SUMMARY)
    val running = MutableStateFlow<RunningShiftView?>(null)
    val list = MutableStateFlow<List<ShiftListItem>>(emptyList())
    val details = MutableStateFlow<Map<String, ShiftDetail>>(emptyMap())
    val sync = MutableStateFlow(sendStatus())
    val vehicleList = MutableStateFlow(listOf(CIVIC))
    val display = MutableStateFlow(DisplaySettings(currency = "CAD", timezone = "UTC", country = "CA"))
    val pairing = MutableStateFlow(PairingStatus.PAIRED)
    val other = MutableStateFlow(OtherServerShifts.NONE)
    var failDelete = false

    var vehiclesOffline = false
    var vehiclesFail = false
    var lastVehicle: Long? = null
    var due = false
    var startResult: StartResult? = null
    var failStart = false
    var sendDone = true
    val calls = mutableListOf<String>()
    var editResult: EditResult = EditResult.Ok

    override fun homeSummary(): Flow<HomeSummary> = summary

    override fun runningShift(): Flow<RunningShiftView?> = running

    override fun shiftList(limit: Int): Flow<List<ShiftListItem>> = list.map { it.take(limit) }

    override fun shiftDetail(clientId: String): Flow<ShiftDetail?> = details.map { it[clientId] }

    override fun syncStatus(): Flow<SendStatus> = sync

    override fun otherServer(): Flow<OtherServerShifts> = other

    override suspend fun deleteOtherServerShifts(): Int {
        calls += "deleteOther"
        if (failDelete) error("disk")
        return other.value.shifts.also { other.value = OtherServerShifts.NONE }
    }

    override fun vehicles(): Flow<List<VehicleRecord>> = vehicleList

    override fun settings(): Flow<DisplaySettings> = display

    override fun pairingStatus(): Flow<PairingStatus> = pairing

    override suspend fun refreshVehicles(): VehicleList {
        calls += "refreshVehicles"
        if (vehiclesFail) error("no network")
        return VehicleList(vehicleList.value, vehiclesOffline)
    }

    override suspend fun lastVehicleId(): Long? = lastVehicle

    override suspend fun startShift(vehicleId: Long, odometerStartM: Long?): StartResult {
        calls += "start $vehicleId ${odometerStartM ?: "-"}"
        if (failStart) error("disk full")
        val r = startResult ?: StartResult.Started(shift("run", startedAt = NOW, endedAt = null, totalM = null).copy(vehicleId = vehicleId))
        if (r is StartResult.Started) running.value = runningView("run")
        return r
    }

    override suspend fun endShift(): EndResult {
        calls += "end"
        val r = running.value ?: return EndResult.NoShift
        running.value = null
        return EndResult.Ended(r.shift.copy(status = ShiftStatus.ENDED, endedAt = NOW), null)
    }

    override suspend fun closeUnfinished(): EndResult {
        calls += "close"
        val r = running.value ?: return EndResult.NoShift
        running.value = null
        return EndResult.Ended(r.shift.copy(status = ShiftStatus.ENDED, endedAt = NOW - HOUR, autoClosed = true), null)
    }

    override suspend fun editTrip(tripKey: String, kind: TripKind?, purpose: String?): EditResult {
        calls += "editTrip $tripKey $kind $purpose"
        return editResult
    }

    override suspend fun addManualTrip(clientId: String, kind: TripKind, startedAt: Long, endedAt: Long, distanceM: Long, purpose: String?): EditResult {
        calls += "addTrip $clientId $kind $distanceM $purpose"
        return editResult
    }

    override suspend fun setOdometer(clientId: String, kind: OdometerKind, readingM: Long): EditResult {
        calls += "odometer $clientId $kind $readingM"
        return editResult
    }

    override suspend fun setNotes(clientId: String, notes: String): EditResult {
        calls += "notes $clientId $notes"
        return editResult
    }

    override suspend fun markOverwriteSeen(id: Long) {
        calls += "seen $id"
    }

    override suspend fun odometerDue(vehicleId: Long): Boolean = due

    override suspend fun markOdometerChecked(vehicleId: Long) {
        calls += "checked $vehicleId"
    }

    override suspend fun sendNow(): Boolean {
        calls += "sendNow"
        return sendDone
    }

    override suspend fun retrySending(): Boolean {
        calls += "retry"
        return sendDone
    }

    override fun cancelSending() {
        calls += "cancel"
    }

    override suspend fun reminderShownOnBanner() {
        calls += "reminderShown"
    }
}

class FakeTracking(var perm: TrackingPermissionState = ALLOWED) : TrackingView {
    override val status = MutableStateFlow(TrackingStatus())
    var resumes = true
    var ensured = 0

    override fun permissions(): TrackingPermissionState = perm

    override suspend fun ensureRunning(): Boolean {
        ensured++
        return true
    }

    override suspend fun resume(shiftClientId: String, startedAt: Long): Boolean {
        if (resumes) status.value = recording(shiftClientId)
        return resumes
    }
}

class FixedNow(var t: Long = NOW) : Now {
    override fun ms(): Long = t
}

/** A paired server with both addresses (plan 28) and its settings. */
val CREDENTIAL = app.milewage.core.pairing.Credential(
    baseUrl = "https://box.tail1234.ts.net",
    homeUrl = "http://192.168.1.20:8080",
    awayUrl = "https://box.tail1234.ts.net",
    deviceId = 7,
    deviceToken = "mwd_secret",
    instanceId = "inst-1",
)

val SERVER_SETTINGS = app.milewage.core.api.Settings(
    country = "CA",
    distanceUnit = app.milewage.core.api.DistanceUnit.KM,
    currency = "CAD",
    timezone = "America/Toronto",
    stopsEnabled = true,
    engineVersion = 4,
    diagnostics = app.milewage.core.api.DiagnosticsSettings(app.milewage.core.api.DiagnosticsLevel.BASIC),
    modules = app.milewage.core.api.Modules(tracking = true, stops = true),
    displayName = "Sam",
    region = "ON",
)

val PAIRED_STATE = app.milewage.core.pairing.PairedState(CREDENTIAL, SERVER_SETTINGS)

/** [app.milewage.phone.model.PairingPort] in memory: the test sets the answers, the calls are recorded. */
class FakePairing(status: PairingStatus = PairingStatus.UNPAIRED) : app.milewage.phone.model.PairingPort {
    val statusFlow = MutableStateFlow(status)
    val setup = MutableStateFlow(false)
    var state: app.milewage.core.pairing.PairedState? = if (status == PairingStatus.PAIRED) PAIRED_STATE else null
    var whereNow: app.milewage.core.connect.Where? = null
    var checkFailure: app.milewage.core.api.ApiException? = null
    var redeemFailure: Exception? = null
    var unsent = false
    val calls = mutableListOf<String>()

    override fun status(): Flow<PairingStatus> = statusFlow

    override fun setupPending(): Flow<Boolean> = setup

    override suspend fun finishSetup() {
        calls += "finishSetup"
        setup.value = false
    }

    override suspend fun paired() = state

    override fun where() = whereNow

    override suspend fun checkConnection(): app.milewage.core.api.ApiException? {
        calls += "check"
        return checkFailure
    }

    private fun becomePaired() {
        state = PAIRED_STATE
        setup.value = true
        statusFlow.value = PairingStatus.PAIRED
    }

    override suspend fun redeem(link: app.milewage.core.pairing.PairingLink) {
        calls += "redeem ${link.baseUrl}"
        redeemFailure?.let { throw it }
        becomePaired()
    }

    override suspend fun hasUnsentData() = unsent

    override suspend fun unpair(confirmed: Boolean): Boolean {
        calls += "unpair $confirmed"
        if (unsent && !confirmed) return false
        state = null
        statusFlow.value = PairingStatus.UNPAIRED
        return true
    }
}

class FakeNet : app.milewage.phone.model.NetView {
    var vpn: Boolean? = null
    var installed = false
    var opened = 0

    override suspend fun vpnActive() = vpn

    override suspend fun tailscaleInstalled() = installed

    override suspend fun openTailscale() {
        opened++
    }
}

class FakeTrackingSettings : app.milewage.phone.model.TrackingSettingsPort {
    var current = app.milewage.core.tracking.TrackingSettings()

    override suspend fun settings() = current

    override suspend fun setNudgeAfter(ms: Long) {
        current = current.copy(nudgeAfterMs = ms)
    }
}

class FakeAppearance : app.milewage.phone.model.AppearancePort {
    override val theme = MutableStateFlow(app.milewage.data.prefs.AppTheme.SYSTEM)
    override val wallpaperColours = MutableStateFlow(false)

    override suspend fun setTheme(theme: app.milewage.data.prefs.AppTheme) {
        this.theme.value = theme
    }

    override suspend fun setWallpaperColours(on: Boolean) {
        wallpaperColours.value = on
    }
}
