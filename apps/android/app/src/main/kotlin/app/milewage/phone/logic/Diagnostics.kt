package app.milewage.phone.logic

import app.milewage.core.connect.Where
import app.milewage.core.diagnostics.PermSnapshot
import app.milewage.core.pairing.HaltReason
import app.milewage.core.pairing.PairingStatus
import app.milewage.core.tracking.TrackingStatus
import app.milewage.tracking.TrackingPermissionState

/** What the diagnostics screen shows: versions, states and counts. Never a coordinate, never a secret. */
data class DiagnosticsInfo(
    val appVersion: String,
    val versionCode: Int,
    val buildType: String,
    val engineVersion: Int,
    val android: String,
    val sdk: Int,
    val phone: String,
    val pairing: PairingStatus,
    val route: Where?,
    /** Host names only (no path, no query, no code). */
    val homeHost: String?,
    val awayHost: String?,
    val tracking: TrackingStatus,
    val permissions: TrackingPermissionState?,
    val unsentShifts: Int,
    val unsentFixes: Long,
    val halt: HaltReason?,
)

/** Where the diagnostics screen reads from (the real one is in AppGraph; a fake in tests). */
interface DiagnosticsSource {
    suspend fun snapshot(): DiagnosticsInfo

    /** `Engine.selfCheck()`: the failing cases; empty when this phone computes exactly like the server. */
    fun selfCheck(): List<String>
}

object DiagnosticsReport {
    private val HOST = Regex("""^[a-z][a-z0-9+.-]*://(\[[^\]]+\]|[^/:?#]+)(:\d+)?""", RegexOption.IGNORE_CASE)

    /** The host (and port) of an address, without path, query or fragment; null when it is not an address. */
    fun hostOf(url: String?): String? = url?.let { HOST.find(it)?.value?.substringAfter("://") }

    /**
     * The text "Copy diagnostics summary" puts on the clipboard, for a bug report. English on
     * purpose (it is read by whoever fixes the bug); states and counts only.
     */
    fun text(i: DiagnosticsInfo, selfCheck: List<String>?): String = buildString {
        appendLine("MileWage diagnostics")
        appendLine("App: ${i.appVersion} (build ${i.versionCode}, ${i.buildType})")
        appendLine("Engine: algorithm ${i.engineVersion}")
        appendLine("Android: ${i.android} (SDK ${i.sdk}), ${i.phone}")
        appendLine(
            "Maths check: " + when {
                selfCheck == null -> "not run"
                selfCheck.isEmpty() -> "passed"
                else -> "failed (${selfCheck.size})"
            },
        )
        selfCheck?.take(MAX_FAILURES)?.forEach { appendLine("  $it") }
        appendLine("Pairing: ${i.pairing.name.lowercase()}")
        appendLine("Sending to: ${i.route?.name?.lowercase() ?: "not chosen"}")
        appendLine("Home address: ${i.homeHost ?: "none"}")
        appendLine("Away address: ${i.awayHost ?: "none"}")
        val t = i.tracking
        appendLine(
            "Tracking: ${t.mode.name.lowercase()}, power ${t.power?.name?.lowercase() ?: "-"}, fixes stored ${t.storedFixes}, " +
                "problem ${t.problem?.name?.lowercase() ?: "none"}",
        )
        i.permissions?.let { p ->
            appendLine(
                "Permissions: precise ${yes(p.preciseLocation)}, all the time ${yes(p.backgroundLocation)}, notifications ${yes(p.notifications)}, " +
                    "location on ${yes(p.locationEnabled)}, battery exempt ${yes(p.ignoringBatteryOptimizations)}",
            )
        }
        appendLine("Not yet on server: ${i.unsentShifts} shifts, ${i.unsentFixes} points")
        append("Halt: ${i.halt?.name?.lowercase() ?: "none"}")
    }

    private fun yes(b: Boolean) = if (b) "yes" else "no"

    const val MAX_FAILURES = 20
}

/** The phone's permissions as diagnostics' `perm.state` reports them (counts and states, no coordinates). */
object PermStates {
    /** [bucket]: `UsageStatsManager.appStandbyBucket` (Android 9+), null when it cannot be read. */
    fun of(perm: TrackingPermissionState, bucket: Int?, powerSave: Boolean) = PermSnapshot(
        fine = perm.preciseLocation,
        background = when {
            perm.preciseLocation && perm.backgroundLocation -> PermSnapshot.Background.ALL_TIME
            perm.preciseLocation || perm.approximateOnly -> PermSnapshot.Background.WHILE_IN_USE
            else -> PermSnapshot.Background.DENIED
        },
        notifications = perm.notifications,
        batteryOptIgnored = perm.ignoringBatteryOptimizations,
        standbyBucket = bucketName(bucket),
        powerSave = powerSave,
    )

    /** The platform's bucket numbers (`UsageStatsManager.STANDBY_BUCKET_*`) in the catalogue's words. */
    fun bucketName(bucket: Int?): String = when (bucket) {
        null -> "unknown"
        in Int.MIN_VALUE..10 -> "active"
        in 11..20 -> "working_set"
        in 21..30 -> "frequent"
        in 31..40 -> "rare"
        in 41..45 -> "restricted"
        else -> "never"
    }
}
