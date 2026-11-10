package app.milewage.core.sync

import app.milewage.core.net.HomeAddress
import app.milewage.core.pairing.Credential
import app.milewage.core.pairing.DeviceClient
import app.milewage.core.shift.LocalStore
import app.milewage.core.shift.OdometerKind
import app.milewage.core.shift.OdometerRecord
import app.milewage.core.shift.RoutePoint
import app.milewage.core.shift.SendState
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.shift.StopRecord
import app.milewage.core.shift.TripRecord
import app.milewage.core.tracking.Interruption
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * What the phone keeps for a server it is not paired with now: shifts recorded for another server
 * that never reached it. They are only ever sent to that server; the driver connects to it again,
 * or deletes them from this phone. A running shift is not counted (it cannot be deleted while it
 * records; it shows "Recorded for another server" in the list).
 */
data class OtherServerShifts(
    /** Ended shifts bound to another server, not yet sent there. */
    val shifts: Int = 0,
    /** Their fixes not yet accepted. */
    val fixes: Long = 0,
    /** Host names of those servers, as the phone last knew them; empty when it never knew one. */
    val hosts: List<String> = emptyList(),
    /** When the oldest of them started. */
    val oldestAt: Long? = null,
) {
    val none: Boolean get() = shifts == 0

    companion object {
        val NONE = OtherServerShifts()

        /**
         * From the shifts not yet sent (any server), their pending fixes, the paired server and the
         * host names the phone kept per instance.
         */
        fun of(unsent: List<ShiftRecord>, pendingFixes: Map<String, Long>, pairedInstance: String?, hosts: Map<String, String>): OtherServerShifts {
            val other = unsent.filter { ServerBinding.waitsElsewhere(it, pairedInstance) }
            if (other.isEmpty()) return NONE
            return OtherServerShifts(
                shifts = other.size,
                fixes = other.sumOf { pendingFixes[it.clientId] ?: 0 },
                hosts = other.mapNotNull { s -> s.instanceId?.let { hosts[it] } }.distinct().sorted(),
                oldestAt = other.minOf { it.startedAt },
            )
        }
    }
}

/**
 * The rule that keeps a driver's location history with the server it was recorded for (15 section
 * 9.4, decision 2026-11-10): every shift is bound to the instance id (`X-MileWage-Instance`) of the
 * server the phone was paired with when it was recorded, and everything queued for it (its outbox
 * rows, fixes, readings, trips, resend mark) is bound through it. Sending only ever sends what is
 * bound to the server the phone is paired with now:
 *
 * - [view] is the store as sending sees it: only the paired server's shifts and what belongs to
 *   them. Another server's rows are invisible to it, so they are never sent, never deleted and never
 *   hold up the queue (the one-active-shift ordering, the unsent count, the reminder, the unpair
 *   check). Its writes cannot touch another server's rows either. Bookkeeping that is per server (the
 *   change-log cursor, the last pull, the restore generation) is kept per server.
 * - [pinned] fixes the paired server for a whole send round, and [guard] hands out the device client
 *   only while its credential is for that same server: a re-pair in the middle of a round stops the
 *   round instead of sending one server's rows with the other's client.
 * - Unbound rows (recorded before this existed, `instanceId` null) belong to the first server paired
 *   afterwards: [settle] and every round claim them.
 *
 * The driver resolves another server's shifts by pairing with it again (they then go as usual) or
 * deleting them from the phone after a confirmation ([deleteElsewhere]).
 */
class ServerBinding(
    private val raw: LocalStore,
    /** The stored credential; null when not paired. Read fresh at each round and each pairing change. */
    private val credential: suspend () -> Credential?,
) {
    private class Paired(val instance: String?)

    @Volatile
    private var cached: Paired? = null

    @Volatile
    private var pinnedTo: Paired? = null

    @Volatile
    private var generation = 0L

    private val settleLock = Mutex()

    /** The store as sending sees it: the paired server's rows only. */
    val view: LocalStore = BoundStore(raw) { instance() }

    /** The instance id the phone is paired with now (the round's while one runs); null when not paired or unknown. */
    suspend fun instance(): String? {
        pinnedTo?.let { return it.instance }
        cached?.let { return it.instance }
        return read().instance
    }

    private suspend fun read(): Paired {
        val g = generation
        val p = Paired(credential()?.instanceId)
        if (g == generation) cached = p
        return p
    }

    /** The pairing changed (a code redeemed, a link, unpaired): forget the cached server. */
    fun invalidate() {
        generation++
        cached = null
    }

    /**
     * After a pairing change and at app start: reads the credential again, binds the unbound rows to
     * the paired server and remembers its host name for the screens ("recorded for box.example").
     */
    suspend fun settle() = settleLock.withLock {
        invalidate()
        val c = credential() ?: return@withLock
        val instance = c.instanceId ?: return@withLock
        raw.bindUnbound(instance)
        hostOf(c)?.let { if (raw.get(hostKey(instance)) != it) raw.put(hostKey(instance), it) }
    }

    /** Runs a send round with the paired server fixed for all of it (read fresh, unbound rows claimed first). */
    suspend fun <T> pinned(block: suspend () -> T): T {
        invalidate()
        val p = read()
        p.instance?.let { raw.bindUnbound(it) }
        pinnedTo = p
        try {
            return block()
        } finally {
            pinnedTo = null
        }
    }

    /** The device client, only while its credential is for the server whose rows are being sent. */
    fun guard(session: suspend () -> DeviceClient?): suspend () -> DeviceClient? = {
        session()?.takeIf { it.credential.instanceId == instance() }
    }

    /** Shifts recorded for another server, still waiting for it. */
    suspend fun elsewhere(): OtherServerShifts {
        if (credential() == null) return OtherServerShifts.NONE
        val paired = instance()
        val unsent = raw.unsentShifts()
        val other = unsent.filter { waitsElsewhere(it, paired) }
        if (other.isEmpty()) return OtherServerShifts.NONE
        val fixes = other.associate { it.clientId to raw.pendingCount(it.clientId) }
        val hosts = other.mapNotNull { it.instanceId }.distinct().mapNotNull { i -> raw.get(hostKey(i))?.let { i to it } }.toMap()
        return OtherServerShifts.of(other, fixes, paired, hosts)
    }

    /** The marker of [shift] for the screens, with the paired server in mind. */
    suspend fun markerOf(shift: ShiftRecord): ShiftMarker = ShiftMarker.of(shift, instance())

    /**
     * Deletes every shift recorded for another server and never sent there ([elsewhere]), with its
     * fixes, readings, trips, stops, route and queued changes, in one transaction. Only after the
     * driver confirmed (the screen names how many and that they were never sent). A running shift is
     * kept. Returns how many were deleted.
     */
    suspend fun deleteElsewhere(): Int {
        if (credential() == null) return 0
        val paired = instance()
        return raw.transaction {
            val gone = raw.unsentShifts().filter { waitsElsewhere(it, paired) }
            for (s in gone) {
                raw.dropChanges(s.clientId)
                raw.deleteShift(s.clientId)
            }
            gone.size
        }
    }

    companion object {
        /** A shift goes only to the server it is bound to: the same instance id (unbound only with unknown). */
        fun boundTo(shiftInstance: String?, pairedInstance: String?): Boolean = shiftInstance == pairedInstance

        /** Not running, not yet sent, and bound to another server than [pairedInstance]. */
        fun waitsElsewhere(s: ShiftRecord, pairedInstance: String?): Boolean =
            !s.running && s.sendState != SendState.SENT && !boundTo(s.instanceId, pairedInstance)

        /** Bookkeeping that belongs to one server: the change-log cursor, the last pull, the restore generation. */
        val PER_SERVER_KEYS: Set<String> = setOf(ChangePuller.CURSOR, ChangePuller.LAST_PULL, RestoreCheck.KEY)

        /** The key [key] has for the server [instance]: per-server keys carry it, the others are shared. */
        fun keyFor(key: String, instance: String?): String = if (instance == null || key !in PER_SERVER_KEYS) key else "$key@$instance"

        /** Where the host name of a server the phone was paired with is kept. */
        fun hostKey(instance: String) = "server.host.$instance"

        /** The name the driver knows the server by: its away host, else its home host, else the address used. */
        fun hostOf(c: Credential): String? = listOfNotNull(c.awayUrl, c.homeUrl, c.baseUrl).firstNotNullOfOrNull { HomeAddress.parts(it)?.host }
    }
}

/**
 * [LocalStore] as sending sees it, for the server [instance] (see [ServerBinding]). Reads leave out
 * every shift bound elsewhere and what belongs to it; writes to another server's rows do nothing; a
 * new shift row without a binding gets this server's. Rows whose shift row does not exist (a fix the
 * tracker wrote a moment before its shift row) count as this server's. Everything else passes through.
 */
internal class BoundStore(private val raw: LocalStore, private val instance: suspend () -> String?) : LocalStore by raw {
    private suspend fun elsewhere(): Set<String> = raw.shiftIdsNotBoundTo(instance())

    private suspend fun here(s: ShiftRecord) = ServerBinding.boundTo(s.instanceId, instance())

    /** True unless [clientId] is a shift bound to another server. */
    private suspend fun here(clientId: String): Boolean = raw.shift(clientId)?.let { here(it) } ?: true

    // Shifts ----------------------------------------------------------------------------------

    override suspend fun shift(clientId: String) = raw.shift(clientId)?.takeIf { here(it) }

    override suspend fun shiftByServerId(serverId: Long) = raw.shiftByServerId(serverId, instance())

    override suspend fun runningShift() = raw.runningShift()?.takeIf { here(it) }

    override suspend fun shifts(limit: Int): List<ShiftRecord> {
        val other = elsewhere()
        return raw.shifts(if (other.isEmpty()) limit else Int.MAX_VALUE).filter { it.clientId !in other }.take(limit)
    }

    override suspend fun unsentShifts(): List<ShiftRecord> {
        val other = elsewhere()
        return raw.unsentShifts().filter { it.clientId !in other }
    }

    override suspend fun shiftsFrom(fromDate: String): List<ShiftRecord> {
        val other = elsewhere()
        return raw.shiftsFrom(fromDate).filter { it.clientId !in other }
    }

    override suspend fun upsertShift(shift: ShiftRecord) {
        val existing = raw.shift(shift.clientId)
        if (existing != null && !here(existing)) return // another server's row: never touched from here
        raw.upsertShift(shift.copy(instanceId = existing?.instanceId ?: shift.instanceId ?: instance()))
    }

    override suspend fun deleteShift(clientId: String) {
        if (here(clientId)) raw.deleteShift(clientId)
    }

    override suspend fun trips(clientId: String) = if (here(clientId)) raw.trips(clientId) else emptyList()

    override suspend fun trip(tripKey: String) = raw.trip(tripKey)?.takeIf { here(it.shiftClientId) }

    override suspend fun upsertTrip(trip: TripRecord) {
        if (here(trip.shiftClientId)) raw.upsertTrip(trip)
    }

    override suspend fun deleteTrip(tripKey: String) {
        if (trip(tripKey) != null) raw.deleteTrip(tripKey)
    }

    override suspend fun stops(clientId: String): List<StopRecord> = if (here(clientId)) raw.stops(clientId) else emptyList()

    override suspend fun route(clientId: String): List<RoutePoint> = if (here(clientId)) raw.route(clientId) else emptyList()

    override suspend fun replaceResult(clientId: String, trips: List<TripRecord>, stops: List<StopRecord>, route: List<RoutePoint>) {
        if (here(clientId)) raw.replaceResult(clientId, trips, stops, route)
    }

    override suspend fun interruptions(clientId: String): List<Interruption> = if (here(clientId)) raw.interruptions(clientId) else emptyList()

    override suspend fun replaceInterruptions(clientId: String, list: List<Interruption>) {
        if (here(clientId)) raw.replaceInterruptions(clientId, list)
    }

    override suspend fun odometer(clientId: String) = if (here(clientId)) raw.odometer(clientId) else emptyList()

    override suspend fun odometerByServerId(serverId: Long) = raw.odometerByServerId(serverId, instance())

    override suspend fun upsertOdometer(reading: OdometerRecord) {
        if (here(reading.shiftClientId)) raw.upsertOdometer(reading)
    }

    override suspend fun deleteOdometer(clientId: String, kind: OdometerKind) {
        if (here(clientId)) raw.deleteOdometer(clientId, kind)
    }

    // Fixes -----------------------------------------------------------------------------------

    override suspend fun shiftsWithPending(): List<String> {
        val other = elsewhere()
        return raw.shiftsWithPending().filter { it !in other }
    }

    override suspend fun pending(shiftClientId: String, limit: Int) = if (here(shiftClientId)) raw.pending(shiftClientId, limit) else emptyList()

    override suspend fun pendingCount(shiftClientId: String?): Long {
        if (shiftClientId != null) return if (here(shiftClientId)) raw.pendingCount(shiftClientId) else 0
        val other = elsewhere()
        val all = raw.pendingCount(null)
        if (other.isEmpty()) return all
        return all - raw.shiftsWithPending().filter { it in other }.sumOf { raw.pendingCount(it) }
    }

    override suspend fun oldestPendingAt(): Long? {
        val other = elsewhere()
        val waiting = raw.shiftsWithPending()
        if (waiting.none { it in other }) return raw.oldestPendingAt()
        return waiting.filter { it !in other }.mapNotNull { raw.pending(it, 1).firstOrNull()?.recordedAt }.minOrNull()
    }

    override suspend fun after(shiftClientId: String, afterSeq: Long, limit: Int) =
        if (here(shiftClientId)) raw.after(shiftClientId, afterSeq, limit) else emptyList()

    override suspend fun manifest(shiftClientId: String) = if (here(shiftClientId)) raw.manifest(shiftClientId) else null

    // Outbox (writes pass through: an edit of another server's shift is queued for that server) ---

    override suspend fun pendingChanges(): List<OutboxItem> {
        val other = elsewhere()
        return raw.pendingChanges().filter { it.shiftClientId !in other }
    }

    override suspend fun parkedChanges(): List<OutboxItem> {
        val other = elsewhere()
        return raw.parkedChanges().filter { it.shiftClientId !in other }
    }

    override suspend fun changeCounts(): OutboxCounts {
        val other = elsewhere()
        if (other.isEmpty()) return raw.changeCounts()
        val pending = raw.pendingChanges().filter { it.shiftClientId !in other }
        val parked = raw.parkedChanges().filter { it.shiftClientId !in other }
        return OutboxCounts(pending.size, parked.size, (pending + parked).minOfOrNull { it.createdAt })
    }

    override suspend fun unparkChanges(shiftClientId: String?): Int {
        if (shiftClientId != null) return if (here(shiftClientId)) raw.unparkChanges(shiftClientId) else 0
        val other = elsewhere()
        if (other.isEmpty()) return raw.unparkChanges(null)
        return raw.parkedChanges().map { it.shiftClientId }.distinct().filter { it !in other }.sumOf { raw.unparkChanges(it) }
    }

    override suspend fun dropChanges(shiftClientId: String) {
        if (here(shiftClientId)) raw.dropChanges(shiftClientId)
    }

    // Resend marks ----------------------------------------------------------------------------

    override suspend fun resendMarks(): List<ResendMark> {
        val other = elsewhere()
        return raw.resendMarks().filter { it.shiftClientId !in other }
    }

    override suspend fun resendMark(shiftClientId: String) = if (here(shiftClientId)) raw.resendMark(shiftClientId) else null

    override suspend fun markForResend(shiftClientIds: List<String>, mark: (String) -> ResendMark) {
        val other = elsewhere()
        raw.markForResend(shiftClientIds.filter { it !in other }, mark)
    }

    // Bookkeeping: the per-server keys carry the server --------------------------------------

    override suspend fun get(key: String) = raw.get(ServerBinding.keyFor(key, instance()))

    override suspend fun put(key: String, value: String) = raw.put(ServerBinding.keyFor(key, instance()), value)

    override suspend fun remove(key: String) = raw.remove(ServerBinding.keyFor(key, instance()))
}
