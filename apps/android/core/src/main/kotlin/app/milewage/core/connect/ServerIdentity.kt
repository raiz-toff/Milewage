package app.milewage.core.connect

import app.milewage.core.api.HttpHeaders
import app.milewage.core.api.MileWageHeaders

/**
 * Who answered, from the headers every MileWage answer carries (apps/server/src/hooks.ts):
 * the API major, the server's version, its instance id and its restore generation.
 */
data class ServerIdentity(
    /** `X-MileWage-Api`; null means the answer did not come from a MileWage server. */
    val api: String?,
    /** `X-MileWage-Server`, the server's version (0.2.0). */
    val serverVersion: String?,
    /** `X-MileWage-Instance`; null before the owner account exists, or not a MileWage answer. */
    val instanceId: String?,
    /** `X-MileWage-Restore-Gen`; grows when the server is restored from a backup. */
    val restoreGeneration: Long?,
) {
    val isMileWage: Boolean get() = api != null

    companion object {
        fun of(headers: HttpHeaders) = ServerIdentity(
            api = headers[MileWageHeaders.API],
            serverVersion = headers[MileWageHeaders.SERVER],
            instanceId = headers[MileWageHeaders.INSTANCE]?.takeIf { it.isNotEmpty() },
            restoreGeneration = headers[MileWageHeaders.RESTORE_GEN]?.trim()?.toLongOrNull(),
        )

        /**
         * A different server than the paired one answers at this address (15 section 9.4): the answer
         * names another instance. An answer without the header (a captive portal, a proxy page) is not
         * a wrong server, and nothing can be said before the phone knows its server's id.
         */
        fun isWrongServer(headers: HttpHeaders, expectedInstance: String?): Boolean {
            val instance = headers[MileWageHeaders.INSTANCE]?.takeIf { it.isNotEmpty() } ?: return false
            return expectedInstance != null && instance != expectedInstance
        }
    }
}
