package app.milewage.core.diagnostics

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull

/*
 * The diagnostics allowlist (16 section 4.2), a port of `packages/shared/src/diagnostics/schema.ts`
 * and `kinds.ts` for the kinds the phone records. A field that is not declared is refused; strings
 * must match a pattern or an enum; every string is also checked for anything that looks like a
 * coordinate, a token or a tailnet name (decision 1.5c: never coordinates). Reasons name a field
 * path, never a value. The server runs the TypeScript original on ingest, so a drift here shows as
 * `rejected` in its answer and is counted.
 */

sealed interface Field {
    val opt: Boolean

    data class Int(val min: Long, val max: Long, override val opt: Boolean = false) : Field

    data class Bool(override val opt: Boolean = false) : Field

    data class OneOf(val values: Set<String>, override val opt: Boolean = false) : Field

    data class Str(val re: Regex, override val opt: Boolean = false) : Field

    data class Ints(val len: kotlin.Int, val min: Long, val max: Long, override val opt: Boolean = false) : Field

    data class Strs(val re: Regex, val maxLen: kotlin.Int, override val opt: Boolean = false) : Field

    data class Obj(val fields: Map<String, Field>, override val opt: Boolean = false) : Field
}

object Patterns {
    val deviceName = Regex("^(?!\\d+ )[A-Za-z0-9 ._+-]{1,40}$")
    val identifier = Regex("^[A-Za-z0-9_.$<>@/:-]{1,120}$")
    val version = Regex("^[0-9A-Za-z._+-]{1,40}$")
    val code = Regex("^[a-z0-9_]{1,40}$")
    val clientId = Regex("^[0-9a-f-]{36}$")
    val printable = Regex("^[\\x20-\\x7e]{1,120}$")

    private val coordinateLike = Regex("-?\\d{1,3}\\.\\d{4,}|(?<![0-9A-Za-z])\\d{9,}(?![0-9A-Za-z])")
    private val credentialLike = Regex("(?<![A-Za-z0-9])mw[dp]_|mw_session|\\.ts\\.net", RegexOption.IGNORE_CASE)

    /** Text that must never be recorded: coordinate-like numbers, token prefixes, tailnet names. */
    fun looksLikeCoordinate(s: String): Boolean = coordinateLike.containsMatchIn(s) || credentialLike.containsMatchIn(s)
}

object Allowlist {
    private fun checkString(v: JsonElement?, re: Regex): Boolean {
        val p = v as? JsonPrimitive ?: return false
        if (!p.isString || !re.matches(p.content)) return false
        return !Patterns.looksLikeCoordinate(p.content)
    }

    private fun isInt(v: JsonElement?, min: Long, max: Long): Boolean {
        val p = v as? JsonPrimitive ?: return false
        if (p.isString) return false
        val n = p.longOrNull ?: return false
        return n in min..max
    }

    fun checkField(f: Field, v: JsonElement, path: String): String? {
        fun bad(why: String) = "$path: $why"
        return when (f) {
            is Field.Int -> if (isInt(v, f.min, f.max)) null else bad("not an integer in range")
            is Field.Bool -> if ((v as? JsonPrimitive)?.let { !it.isString && it.booleanOrNull != null } == true) null else bad("not a boolean")
            is Field.OneOf -> if ((v as? JsonPrimitive)?.let { it.isString && it.content in f.values } == true) null else bad("not allowed")
            is Field.Str -> if (checkString(v, f.re)) null else bad("does not match its pattern")
            is Field.Ints -> if (v is JsonArray && v.size == f.len && v.all { isInt(it, f.min, f.max) }) null else bad("not a fixed-length integer array")
            is Field.Strs -> if (v is JsonArray && v.size <= f.maxLen && v.all { checkString(it, f.re) }) null else bad("not an allowed string array")
            is Field.Obj -> checkShape(f.fields, v, path)
        }
    }

    /** Every declared field is checked, required ones must be present, undeclared ones are refused. */
    fun checkShape(shape: Map<String, Field>, v: JsonElement, path: String): String? {
        val obj = v as? JsonObject ?: return "$path: not an object"
        for (k in obj.keys) if (k !in shape) return "$path.$k: field not allowed"
        for ((k, f) in shape) {
            val value = obj[k]
            if (value == null) {
                if (!f.opt) return "$path.$k: missing"
                continue
            }
            checkField(f, value, "$path.$k")?.let { return it }
        }
        return null
    }

    /** Our own error classes, SQLite codes and network classes may carry a (redacted) message (16 section 4.3). */
    val CRASH_MSG_CLASS = Regex("^(Milewage[A-Za-z]*Error|SQLITE_[A-Z_]+|[A-Za-z]*(Network|Timeout)Error|ECONN[A-Z]+|ETIMEDOUT)$")

    fun crashMessage(cls: String, message: String?): String? {
        if (message == null || !CRASH_MSG_CLASS.matches(cls)) return null
        val printable = message.map { if (it in ' '..'~') it else ' ' }.joinToString("").take(120)
        return printable.split(Regex("(?<=\\s)|(?=\\s)")).joinToString("") { if (Patterns.looksLikeCoordinate(it)) "[redacted]" else it }
            .takeIf { it.isNotBlank() }
    }
}

/** One kind of the catalogue (16 section 3.2): its level, producers and data shape. */
class KindSpec(val level: String, val src: Set<String>, val data: Map<String, Field>)

/** The kinds this phone records (a subset of `kinds.ts`, same shapes). */
object DiagKinds {
    private val COUNT = Field.Int(0, 1_000_000_000)
    private val BIG = Field.Int(0, 1_000_000_000_000)
    private val MS = Field.Int(0, 86_400_000)
    private val VERSION = Field.Str(Patterns.version)
    private fun bool(opt: Boolean = false) = Field.Bool(opt)
    private fun oneOf(vararg v: String) = Field.OneOf(v.toSet())

    val SERVICE_EVENTS = setOf(
        "created", "started", "restarted", "destroyed", "task_removed", "fgs_start_refused", "permission_lost", "recovered",
        "still_gate_on", "still_gate_off",
    )
    val SERVICE_REASONS = setOf("user_stop", "shift_end", "task_removed", "os_kill_inferred", "start_not_allowed", "permission", "crash", "unknown")
    private val MODULES = listOf("devices", "tracking", "stops", "replay", "sync", "exporters", "diagnostics", "capture")
    private val ENGINE_STATS = listOf("non_positive_dt", "speed_spike", "within_gate", "low_accuracy", "fixes_in", "fixes_used", "gap_m")

    val all: Map<String, KindSpec> = mapOf(
        "service.event" to KindSpec(
            "basic", setOf("phone_native"),
            mapOf("event" to Field.OneOf(SERVICE_EVENTS), "reason" to Field.OneOf(SERVICE_REASONS), "profile" to oneOf("normal", "capture")),
        ),
        "app.start" to KindSpec(
            "basic", setOf("phone_js"),
            mapOf(
                "app_v" to VERSION, "native_v" to VERSION, "engine_v" to VERSION, "api_v" to VERSION,
                "device" to Field.Obj(
                    mapOf(
                        "make" to Field.Str(Patterns.deviceName), "model" to Field.Str(Patterns.deviceName), "android" to VERSION,
                        "sdk" to Field.Int(1, 100), "oneui" to Field.Str(Patterns.version, opt = true),
                    ),
                ),
            ),
        ),
        "upload.window" to KindSpec(
            "basic", setOf("phone_js"),
            listOf("attempts", "ok", "fail_net", "fail_4xx", "fail_5xx", "fail_429", "fail_507", "pending_points", "oldest_pending_s")
                .associateWith { COUNT } + mapOf("bytes_gz" to BIG, "dur_p95_ms" to MS),
        ),
        "upload.drain" to KindSpec(
            "basic", setOf("phone_js"),
            mapOf("shifts" to COUNT, "points" to COUNT, "batches" to COUNT, "bytes_gz" to BIG, "wall_ms" to BIG, "ok" to bool()),
        ),
        "shift.summary" to KindSpec(
            "basic", setOf("phone_js"),
            mapOf(
                "duration_s" to COUNT, "battery_start" to Field.Int(0, 100), "battery_end" to Field.Int(0, 100), "charging_seen" to bool(),
                "fixes" to COUNT, "gap_count" to COUNT, "service_restarts" to COUNT, "engine_ms" to MS, "capture" to bool(),
            ),
        ),
        "engine.run" to KindSpec(
            "basic", setOf("phone_js", "server"),
            mapOf(
                "host" to oneOf("phone", "server"),
                "reason" to oneOf("shift_end", "late_points", "label", "recalc", "upgrade"),
                "calc_version" to Field.Int(0, 10_000),
                "segmenter" to oneOf("stops", "whole_shift"),
                "input_digest" to VERSION,
                "ms" to MS,
                "stats" to Field.Obj(ENGINE_STATS.associateWith { Field.Int(0, 1_000_000_000, opt = true) }),
                "flags" to Field.Strs(Patterns.code, 32),
                "trips" to COUNT, "stops" to COUNT, "total_m" to COUNT, "active_m" to COUNT, "deadhead_m" to COUNT,
            ),
        ),
        "sync.state" to KindSpec(
            "basic", setOf("phone_js"),
            mapOf(
                "state" to oneOf("reachable", "unreachable", "unauthorized", "revoked", "wrong_instance", "restored", "api_too_old"),
                "since_s" to COUNT,
            ),
        ),
        "sync.pull" to KindSpec("basic", setOf("phone_js"), mapOf("applied" to COUNT, "conflicts_logged" to COUNT, "full_window" to bool())),
        "settings.applied" to KindSpec(
            "basic", setOf("phone_js"),
            mapOf(
                "level" to oneOf("off", "basic", "verbose"),
                "stops_enabled" to bool(),
                "modules" to Field.Obj(MODULES.associateWith { Field.Bool(opt = true) }),
                "engine_version" to VERSION,
            ),
        ),
        "storage.state" to KindSpec(
            "basic", setOf("phone_js"),
            mapOf(
                "free_mb_bucket" to oneOf("lt20", "lt50", "lt200", "lt1000", "ge1000"),
                "state" to oneOf("normal", "low", "critical"),
                "tracker_db_mb" to COUNT, "app_db_mb" to COUNT, "unsynced_shifts" to COUNT, "pending_points" to COUNT, "quarantine_rows" to COUNT,
            ),
        ),
        "crash" to KindSpec(
            "basic", setOf("phone_native", "phone_js", "server", "web"),
            mapOf(
                "runtime" to oneOf("js", "native", "server", "web"),
                "class" to Field.Str(Patterns.identifier),
                "frames" to Field.Strs(Patterns.identifier, 15),
                "fatal" to bool(),
                "sig" to Field.Str(Patterns.version, opt = true),
                "msg" to Field.Str(Patterns.printable, opt = true),
            ),
        ),
        "diag.self" to KindSpec(
            "basic", setOf("phone_native", "phone_js", "server"),
            mapOf(
                "dropped" to Field.Obj(listOf("ring_full", "schema_reject", "level_off", "disk_low").associateWith { COUNT }),
                "pending" to COUNT, "ring_kb" to COUNT, "cpu_ms_per_h" to COUNT, "writes_per_h" to COUNT,
            ),
        ),
    )
}
