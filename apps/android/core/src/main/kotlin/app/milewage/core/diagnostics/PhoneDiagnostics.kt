package app.milewage.core.diagnostics

import app.milewage.core.api.Api
import app.milewage.core.api.ApiClient
import app.milewage.core.api.ApiException
import app.milewage.core.api.DiagEventIn
import app.milewage.core.api.DiagEventLevel
import app.milewage.core.api.DiagIngestRequest
import app.milewage.core.api.DiagSource
import app.milewage.core.api.DiagnosticsLevel
import app.milewage.core.api.Settings
import app.milewage.core.pairing.HaltReason
import app.milewage.core.ports.Clock
import app.milewage.core.shift.Bookkeeping
import app.milewage.core.shift.PhoneRun
import app.milewage.core.shift.ShiftRecord
import app.milewage.core.sync.Round
import app.milewage.core.sync.StorageState
import app.milewage.core.sync.UploadStats
import app.milewage.core.sync.storageState
import app.milewage.core.tracking.TrackingDiagnostics
import app.milewage.engine.FlagCode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The diagnostics ring, stored with the rest of the phone's data (16 section 6.1). */
interface DiagStore {
    suspend fun appendDiag(event: DiagEventIn)

    /** Oldest first, with their row ids. */
    suspend fun oldestDiag(limit: Int): List<Pair<Long, DiagEventIn>>

    suspend fun deleteDiag(ids: List<Long>)

    suspend fun diagCount(): Int

    suspend fun clearDiag()
}

/** The phone's permissions as `perm.state` reports them (16 section 3.2). */
data class PermSnapshot(
    /** Precise location allowed. */
    val fine: Boolean,
    val background: Background,
    val notifications: Boolean,
    val batteryOptIgnored: Boolean,
    /** active, working_set, frequent, rare, restricted, never, unknown. */
    val standbyBucket: String,
    val powerSave: Boolean,
) {
    enum class Background(val wire: String) { ALL_TIME("all_time"), WHILE_IN_USE("while_in_use"), DENIED("denied") }
}

/** What a flush did. */
enum class FlushResult { SENT, SKIPPED, RETRY, MODULE_OFF }

/**
 * The phone's diagnostics (16 section 6; decision 1.5c: only to the owner's own server, counts and
 * states, never coordinates), a port of the Expo app's `diagnostics/phoneDiagnostics.ts`. Every
 * event passes the [Allowlist] before it is stored, so a buggy caller cannot put a field or a
 * coordinate into the ring; a refused event is counted, never logged and never kept. Sent through
 * `POST /diagnostics/events` (gzipped) by [flush], never while fixes wait to be sent.
 *
 * Sources: the app's own events go as `phone_js` (the contract's name for the app layer: the server
 * accepts `app.start`, `shift.summary` and the others only from it), the tracker's as `phone_native`.
 */
class PhoneDiagnostics(
    private val store: DiagStore,
    private val book: Bookkeeping,
    private val appVersion: String,
    private val clock: Clock,
    /** True while fixes wait to be sent: tax data first (16 section 6.4). */
    private val fixesPending: suspend () -> Boolean = { false },
    /** The most events kept (16 section 6.3); smaller in tests. */
    private val ringCap: Int = RING_CAP,
    /**
     * The instance id of the server the phone is paired with now; null when not paired. The ring
     * belongs to one server: events go only to the server paired when they were recorded, so a
     * pairing with another server starts an empty ring (the old one's events are dropped, never sent
     * to the new one). Unpaired, the ring keeps its server.
     */
    private val server: suspend () -> String? = { null },
) {
    @Serializable
    private data class State(
        val seq: Long = 0,
        val ringFull: Long = 0,
        val schemaReject: Long = 0,
        val levelOff: Long = 0,
        val diskLow: Long = 0,
        val level: String = "basic",
        val verboseUntil: Long? = null,
        val moduleOn: Boolean = true,
        /** The server the events in the ring were recorded for. */
        val server: String? = null,
        /** The last `perm.state` recorded (its data), to record only changes. */
        val perm: String? = null,
        /** The last `storage.state` bucket and state, and when it was recorded. */
        val storage: String? = null,
        val storageAt: Long? = null,
        /** The last `sync.state`, since when it holds, and when it was last recorded. */
        val sync: String? = null,
        val syncSince: Long? = null,
        val syncAt: Long? = null,
    )

    private val lock = Mutex()
    private var state: State? = null

    private suspend fun st(): State = state ?: (book.get(KEY)?.let { runCatching { JSON.decodeFromString(State.serializer(), it) }.getOrNull() } ?: State()).also { state = it }

    private suspend fun save(s: State) {
        state = s
        book.put(KEY, JSON.encodeToString(State.serializer(), s))
    }

    /** The level in force: module off or `off` is nothing; verbose reverts to basic when it expires. */
    suspend fun effectiveLevel(): DiagnosticsLevel = lock.withLock { levelOf(st()) }

    private fun levelOf(s: State): DiagnosticsLevel = when {
        !s.moduleOn || s.level == "off" -> DiagnosticsLevel.OFF
        s.level == "verbose" && s.verboseUntil != null && clock.nowMs() < s.verboseUntil -> DiagnosticsLevel.VERBOSE
        else -> DiagnosticsLevel.BASIC
    }

    /** From the settings: the level, the verbose expiry and the module flag. Off deletes what is unsent. */
    suspend fun applySettings(settings: Settings) {
        lock.withLock {
            val level = when (settings.diagnostics.level) {
                DiagnosticsLevel.OFF -> "off"
                DiagnosticsLevel.BASIC -> "basic"
                DiagnosticsLevel.VERBOSE -> "verbose"
            }
            val next = st().copy(level = level, verboseUntil = settings.diagnostics.verboseUntil, moduleOn = settings.modules.diagnostics == true)
            save(next)
            if (levelOf(next) == DiagnosticsLevel.OFF) store.clearDiag() // "unsent local rows are deleted"
        }
    }

    /** The ring is [instance]'s from now on: another server's events in it are dropped first. Call under [lock]. */
    private suspend fun own(instance: String?): State {
        val s = st()
        if (instance == null || instance == s.server) return s
        store.clearDiag()
        return s.copy(server = instance).also { save(it) }
    }

    /** Records one event if the level allows it and the allowlist accepts it. Returns whether it was kept. */
    suspend fun record(kind: String, data: JsonObject, shift: String? = null, src: DiagSource = DiagSource.PHONE_JS): Boolean = lock.withLock {
        val s = own(server())
        val spec = DiagKinds.all[kind]
        val level = levelOf(s)
        if (level == DiagnosticsLevel.OFF || (spec?.level == "verbose" && level != DiagnosticsLevel.VERBOSE)) {
            save(s.copy(levelOff = s.levelOff + 1))
            return@withLock false
        }
        val reason = validate(kind, spec, src, shift, data)
        if (reason != null) {
            save(s.copy(schemaReject = s.schemaReject + 1)) // the reason names a path only; it is not kept either
            return@withLock false
        }
        val event = DiagEventIn(
            kind = kind,
            at = clock.nowMs(),
            level = if (spec!!.level == "verbose") DiagEventLevel.VERBOSE else DiagEventLevel.BASIC,
            src = src,
            seq = s.seq + 1,
            shift = shift,
            v = appVersion,
            data = data,
        )
        store.appendDiag(event)
        save(s.copy(seq = s.seq + 1, ringFull = s.ringFull + enforceCap()))
        true
    }

    private fun validate(kind: String, spec: KindSpec?, src: DiagSource, shift: String?, data: JsonObject): String? {
        spec ?: return "event.kind: unknown kind"
        if (srcName(src) !in spec.src) return "event.src: not allowed for this kind"
        if (shift != null && !Patterns.clientId.matches(shift)) return "event.shift: not an id"
        if (!Patterns.version.matches(appVersion) || Patterns.looksLikeCoordinate(appVersion)) return "event.v: not a version"
        Allowlist.checkShape(spec.data, data, "data")?.let { return it }
        if (kind == "crash" && data["msg"] != null) {
            val cls = (data["class"] as? JsonPrimitive)?.content ?: ""
            if (!Allowlist.CRASH_MSG_CLASS.matches(cls)) return "data.msg: not allowed for this class"
        }
        return null
    }

    /** The drop order of 16 section 6.3: verbose first, then the cheap windows, then unprotected kinds, then the oldest. */
    private suspend fun enforceCap(): Long {
        var dropped = 0L
        var count = store.diagCount()
        while (count > ringCap) {
            val oldest = store.oldestDiag(500)
            val order: List<(DiagEventIn) -> Boolean> = listOf(
                { it.level == DiagEventLevel.VERBOSE },
                { it.kind in DROPPABLE_FIRST },
                { it.kind !in PROTECTED },
                { true },
            )
            val victim = order.firstNotNullOfOrNull { pick -> oldest.firstOrNull { pick(it.second) } } ?: break
            store.deleteDiag(listOf(victim.first))
            dropped++
            count--
        }
        return dropped
    }

    suspend fun size(): Int = store.diagCount()

    /** `app.start`, once per process start. */
    suspend fun recordAppStart(engineVersion: String, make: String, model: String, android: String, sdk: Int) {
        fun clean(v: String, fallback: String) = v.replace(Regex("[^A-Za-z0-9 ._+-]"), "").take(40).ifBlank { fallback }
        record(
            "app.start",
            buildJsonObject {
                put("app_v", appVersion)
                put("native_v", appVersion)
                put("engine_v", engineVersion)
                put("api_v", "1")
                put(
                    "device",
                    buildJsonObject {
                        put("make", clean(make, "unknown"))
                        put("model", clean(model, "unknown"))
                        put("android", clean(android, "0").replace(" ", ""))
                        put("sdk", sdk.coerceIn(1, 100))
                    },
                )
            },
        )
    }

    /**
     * `shift.summary` and `engine.run` at a shift's end. The summary only with both battery levels
     * (the allowlist requires them; a guessed level would mislead the battery health check).
     */
    suspend fun recordShiftEnd(shift: ShiftRecord, run: PhoneRun?, engineMs: Long, serviceRestarts: Int) {
        val ms = engineMs.coerceIn(0, 86_400_000)
        val start = shift.batteryStart
        val end = shift.batteryEnd
        val endedAt = shift.endedAt ?: return
        if (start != null && end != null) {
            record(
                "shift.summary",
                buildJsonObject {
                    put("duration_s", maxOf(0, (endedAt - shift.startedAt + 500) / 1000))
                    put("battery_start", start.level)
                    put("battery_end", end.level)
                    put("charging_seen", start.charging || end.charging)
                    put("fixes", run?.manifest?.pointCount ?: 0)
                    // One gap is one gap_counted or one gap_dropped; gap_large only qualifies a counted one.
                    put("gap_count", run?.result?.flags?.count { it.code == FlagCode.GAP_COUNTED || it.code == FlagCode.GAP_DROPPED } ?: 0)
                    put("service_restarts", serviceRestarts)
                    put("engine_ms", ms)
                },
                shift.clientId,
            )
        }
        val r = run?.result ?: return
        record(
            "engine.run",
            buildJsonObject {
                put("host", "phone")
                put("reason", "shift_end")
                put("calc_version", r.algorithmVersion)
                put("segmenter", if (shift.segmenter == app.milewage.core.api.Segmenter.STOPS) "stops" else "whole_shift")
                put("input_digest", r.inputDigest)
                put("ms", ms)
                put("stats", JsonObject(r.stats.filterKeys { it in ENGINE_STATS }.mapValues { JsonPrimitive(it.value.coerceIn(0, 1_000_000_000)) }))
                put("flags", JsonArray(r.flags.map { JsonPrimitive(it.code.wire) }.distinct().take(32)))
                put("trips", r.trips.size)
                put("stops", r.stops.size)
                put("total_m", r.totals.totalM)
                put("active_m", r.totals.activeM)
                put("deadhead_m", r.totals.deadheadM)
            },
            shift.clientId,
        )
    }

    /** `upload.window` from the point sender's counters. */
    suspend fun recordUploadWindow(stats: UploadStats, pendingFixes: Long, oldestPendingS: Long) {
        val sorted = stats.durationsMs.sorted()
        val p95 = if (sorted.isEmpty()) 0 else sorted[minOf(sorted.size - 1, kotlin.math.ceil(sorted.size * 0.95).toInt() - 1)]
        record(
            "upload.window",
            buildJsonObject {
                put("attempts", stats.attempts)
                put("ok", stats.ok)
                put("fail_net", stats.failNet)
                put("fail_4xx", stats.fail4xx)
                put("fail_5xx", stats.fail5xx)
                put("fail_429", stats.fail429)
                put("fail_507", stats.fail507)
                put("bytes_gz", stats.bytes)
                put("dur_p95_ms", p95.coerceIn(0, 86_400_000))
                put("pending_points", pendingFixes.coerceAtMost(1_000_000_000))
                put("oldest_pending_s", oldestPendingS.coerceIn(0, 1_000_000_000))
            },
        )
    }

    /** `perm.state` when it changed since the last one (16 section 3.2); the server's health check reads the latest. */
    suspend fun recordPermissions(p: PermSnapshot) {
        val data = buildJsonObject {
            put("fine", p.fine)
            put("background", p.background.wire)
            put("activity_recognition", false) // the app never asks for it
            put("notifications", p.notifications)
            put("battery_opt_ignored", p.batteryOptIgnored)
            put("standby_bucket", p.standbyBucket)
            put("power_save", p.powerSave)
        }
        if (lock.withLock { st().perm } == data.toString()) return
        if (record("perm.state", data)) lock.withLock { save(st().copy(perm = data.toString())) }
    }

    /**
     * `storage.state` when the free-space bucket or state changed, else at most once a day. Nothing
     * when the free space cannot be read (the state is unknown, which the event cannot say).
     */
    suspend fun recordStorage(freeBytes: Long?, databaseBytes: Long, unsentShifts: Int, pendingFixes: Long, setAsideFixes: Long) {
        val free = freeBytes ?: return
        val state = when (storageState(free)) {
            StorageState.CRITICAL -> "critical"
            StorageState.LOW -> "low"
            else -> "normal"
        }
        val bucket = freeBucket(free)
        val key = "$bucket/$state"
        val now = clock.nowMs()
        val last = lock.withLock { st() }
        if (last.storage == key && last.storageAt != null && now - last.storageAt < DAY_MS) return
        val kept = record(
            "storage.state",
            buildJsonObject {
                put("free_mb_bucket", bucket)
                put("state", state)
                // One database holds everything, the tracker's fixes too.
                put("tracker_db_mb", 0)
                put("app_db_mb", (databaseBytes / MB).coerceIn(0, 1_000_000_000))
                put("unsynced_shifts", unsentShifts.coerceAtLeast(0))
                put("pending_points", pendingFixes.coerceIn(0, 1_000_000_000))
                put("quarantine_rows", setAsideFixes.coerceIn(0, 1_000_000_000))
            },
        )
        if (kept) lock.withLock { save(st().copy(storage = key, storageAt = now)) }
    }

    /**
     * `sync.state` when the connection to the server changed, and once a day while a state other than
     * reachable holds (`since_s`: how long it has held, as the phone noticed it). Null: nothing to
     * say (before the first round, not paired).
     */
    suspend fun recordSyncState(state: String?) {
        state ?: return
        val now = clock.nowMs()
        val last = lock.withLock { st() }
        val start = if (last.sync == state) last.syncSince ?: now else now
        if (last.sync == state && (state == "reachable" || last.syncAt == null || now - last.syncAt < DAY_MS)) return
        val since = maxOf(0, (now - start) / 1000).coerceAtMost(1_000_000_000)
        if (record("sync.state", buildJsonObject { put("state", state); put("since_s", since) })) {
            lock.withLock { save(st().copy(sync = state, syncSince = start, syncAt = now)) }
        }
    }

    /**
     * `crash` from a Kotlin throwable: the class must look like an identifier, frames keep only
     * method names (never file names or lines), the message only for allowlisted classes, redacted.
     */
    suspend fun recordCrash(error: Throwable, fatal: Boolean) {
        val name = error::class.simpleName ?: "Error"
        val cls = if (Patterns.identifier.matches(name)) name else "Error"
        val frames = error.stackTraceNames().filter { Patterns.identifier.matches(it) && !Patterns.looksLikeCoordinate(it) }.take(15)
        val msg = Allowlist.crashMessage(cls, error.message)
        record(
            "crash",
            buildJsonObject {
                put("runtime", "native")
                put("class", cls)
                put("frames", JsonArray(frames.map(::JsonPrimitive)))
                put("fatal", fatal)
                if (msg != null) put("msg", msg)
            },
            src = DiagSource.PHONE_NATIVE,
        )
    }

    /** `diag.self`: what was dropped and how much is waiting. */
    suspend fun recordSelf() {
        val s = lock.withLock { st() }
        val pending = store.diagCount()
        record(
            "diag.self",
            buildJsonObject {
                put(
                    "dropped",
                    buildJsonObject {
                        put("ring_full", s.ringFull)
                        put("schema_reject", s.schemaReject)
                        put("level_off", s.levelOff)
                        put("disk_low", s.diskLow)
                    },
                )
                put("pending", pending)
                put("ring_kb", pending.toLong() * 300 / 1024)
                put("cpu_ms_per_h", 0)
                put("writes_per_h", 0)
            },
        )
    }

    /**
     * Sends up to 200 events. Skipped when the level is off, the ring is empty or fixes wait. 200
     * deletes what was sent (accepted, duplicate and rejected alike); 404 means the module is off on
     * the server (behave as off); 422 (or 413 for a single event) drops the batch; anything else keeps it.
     */
    suspend fun flush(client: ApiClient, instance: String? = null): FlushResult {
        if (effectiveLevel() == DiagnosticsLevel.OFF) return FlushResult.SKIPPED
        // Only events recorded for [instance], the server [client] talks to.
        lock.withLock { own(instance) }
        if (fixesPending()) return FlushResult.SKIPPED
        val batch = store.oldestDiag(DiagIngestRequest.MAX_EVENTS)
        if (batch.isEmpty()) return FlushResult.SKIPPED
        return try {
            val res = client.call(Api.diagnostics, DiagIngestRequest(batch.map { it.second })).data
            store.deleteDiag(batch.map { it.first })
            lock.withLock { st().let { save(it.copy(schemaReject = it.schemaReject + res.rejected.size)) } }
            FlushResult.SENT
        } catch (e: ApiException) {
            when {
                e.status == 404 -> {
                    lock.withLock { save(st().copy(moduleOn = false)) }
                    store.clearDiag()
                    FlushResult.MODULE_OFF
                }
                e.status == 422 || (e.status == 413 && batch.size == 1) -> {
                    store.deleteDiag(batch.map { it.first })
                    lock.withLock { st().let { save(it.copy(schemaReject = it.schemaReject + batch.size)) } }
                    FlushResult.SENT
                }
                else -> FlushResult.RETRY
            }
        }
    }

    /**
     * The tracker's events as `service.event` (phone_native). Its other events (prompts, power
     * changes the allowlist has no kind for) are counted as refused, never stored.
     */
    fun trackingSink(scope: CoroutineScope): TrackingDiagnostics = TrackingDiagnostics { event, detail ->
        val mapped = serviceEventOf(event, detail)
        scope.launch {
            if (mapped == null) {
                lock.withLock { st().let { save(it.copy(schemaReject = it.schemaReject + 1)) } }
            } else {
                record(
                    "service.event",
                    buildJsonObject {
                        put("event", mapped.first)
                        put("reason", mapped.second)
                        put("profile", "normal")
                    },
                    src = DiagSource.PHONE_NATIVE,
                )
            }
        }
    }

    companion object {
        /** 16 section 6.3, basic store. */
        const val RING_CAP = 8000
        private const val DAY_MS = 86_400_000L
        private const val MB = 1024L * 1024

        /** The catalogue's free-space buckets. */
        fun freeBucket(freeBytes: Long): String = when {
            freeBytes < 20 * MB -> "lt20"
            freeBytes < 50 * MB -> "lt50"
            freeBytes < 200 * MB -> "lt200"
            freeBytes < 1000 * MB -> "lt1000"
            else -> "ge1000"
        }

        /**
         * `sync.state` from what sending knows: a halt names its cause, a restore says restored, the last
         * round says reachable or unreachable. Null before any round, or with no pairing.
         */
        fun syncStateOf(halt: HaltReason?, restored: Boolean, round: Round.State?): String? = when {
            halt == HaltReason.REPAIR -> "revoked"
            halt == HaltReason.WRONG_SERVER -> "wrong_instance"
            halt == HaltReason.AUTH_PROBLEM -> "unauthorized"
            restored -> "restored"
            round == Round.State.OFFLINE -> "unreachable"
            round == Round.State.IDLE || round == Round.State.CANCELLED -> "reachable"
            else -> null
        }
        const val KEY = "diag.state"
        private val JSON = Json { ignoreUnknownKeys = true }
        private val PROTECTED = setOf("crash", "app.start", "service.event", "engine.run", "shift.summary", "diag.self")
        private val DROPPABLE_FIRST = setOf("track.window", "upload.window")
        private val ENGINE_STATS = setOf("non_positive_dt", "speed_spike", "within_gate", "low_accuracy", "fixes_in", "fixes_used", "gap_m")

        fun srcName(s: DiagSource) = when (s) {
            DiagSource.PHONE_NATIVE -> "phone_native"
            DiagSource.PHONE_JS -> "phone_js"
            DiagSource.SERVER -> "server"
            DiagSource.WEB -> "web"
        }

        /** The tracker's event names (`TrackingCore`, the receivers) in the catalogue's terms; null: no kind for it. */
        fun serviceEventOf(event: String, detail: Map<String, String>): Pair<String, String>? = when (event) {
            "service_start" -> if (detail["mode"] == "stopped") null else "started" to "unknown"
            "interruption" -> when (detail["reason"]) {
                "service_restarted" -> "restarted" to "os_kill_inferred"
                "permission_lost" -> "permission_lost" to "permission"
                else -> null
            }
            "resume_refused" -> "fgs_start_refused" to (if (detail["reason"] == "permission") "permission" else "start_not_allowed")
            "shift_stop" -> "destroyed" to "shift_end"
            "power" -> if (detail["level"] == "low") "still_gate_on" to "unknown" else "still_gate_off" to "unknown"
            "core_error", "command_error", "storage_error" -> "recovered" to "crash"
            else -> null
        }
    }
}

/** Method names of a throwable's stack, without file names or line numbers (Kotlin common: from its text). */
internal fun Throwable.stackTraceNames(): List<String> =
    stackTraceToString().lines().mapNotNull { line ->
        Regex("^\\s*at\\s+([A-Za-z0-9_.$<>]+)\\(").find(line)?.groupValues?.get(1)
    }
