package app.milewage.core.api

/**
 * A request that did not succeed. [code] is the server's Problem `code`, or one of the phone's own
 * ([ApiCodes]) when there was no usable answer. [status] is 0 when nothing answered. The message
 * holds only the status and the code: never a token, an address or a body.
 */
class ApiException(
    val status: Int,
    val code: String,
    val retryable: Boolean,
    /** Seconds from `Retry-After`, when the server sent one. */
    val retryAfterS: Long? = null,
    /** The problem body, when the server wrote one. */
    val problem: Problem? = null,
) : Exception("$status $code") {
    /** What went wrong, for the screens and the senders to act on. */
    val failure: ApiFailure get() = ApiFailure.of(status, code)
}

/** The codes the phone makes itself (the server's own are in its error catalogue). */
object ApiCodes {
    /** Nothing answered (no network, server off, Tailscale off). Retryable. */
    const val NETWORK = "network"

    /** An answer the phone could not read (not JSON, or not the contract's shape). */
    const val BAD_RESPONSE = "bad_response"

    /** Plain http outside the home network: refused before anything was sent. */
    const val INSECURE_ADDRESS = "insecure_address"

    /** The address answers as another MileWage server than the paired one: nothing is sent. Retryable. */
    const val WRONG_SERVER = "wrong_server"

    /** Something answered, but not a MileWage server (no `X-MileWage-Api`). */
    const val NOT_MILEWAGE = "not_milewage"

    /** The server speaks another API major version (`X-MileWage-Api` is not 1): the app is too old or too new. */
    const val API_UNSUPPORTED = "api_unsupported"

    // Server codes the phone acts on (apps/server/src/errors.ts).
    const val DEVICE_REVOKED = "device_revoked"
    const val INVALID_PAIRING_TOKEN = "invalid_pairing_token"
    const val LINK_EXPIRED = "link_expired"
    const val SLOW_DOWN = "slow_down"
    const val RATE_LIMITED = "rate_limited"
    const val UPGRADE_REQUIRED = "upgrade_required"
    const val READ_ONLY_MODE = "read_only_mode"
    const val RESTORING = "restoring"
    const val INSUFFICIENT_STORAGE = "insufficient_storage"
    const val CURSOR_EXPIRED = "cursor_expired"
    const val SHIFT_ALREADY_ACTIVE = "shift_already_active"
    const val SHIFT_NOT_FOUND = "shift_not_found"
    const val SHIFT_FINALIZED = "shift_finalized"
}

/**
 * The kinds of failure the UI turns into the MileWage voice and the senders act on, from
 * (status, code). Mirrors the Expo client's taxonomy (`ApiError` codes) plus the version checks.
 */
enum class ApiFailure {
    /** Nothing answered: retry later; on a home address say "same Wi-Fi?", on a tailnet one ask about Tailscale. */
    UNREACHABLE,

    /** Plain http outside the home network: never sent. */
    INSECURE_ADDRESS,

    /** Another MileWage server answers at this address: everything waits until the driver re-pairs. */
    WRONG_SERVER,

    /** Not a MileWage server at that address. */
    NOT_MILEWAGE,

    /** An answer the phone could not read. */
    BAD_RESPONSE,

    /** The server revoked this phone (401 device_revoked): connect again. */
    REVOKED,

    /** Any other 401: sign-in problem, re-pair. */
    UNAUTHORIZED,

    /** 403: this credential may not do that. */
    FORBIDDEN,

    /** 426 upgrade_required: this app is too old for the server. */
    APP_TOO_OLD,

    /** Another API major version: the server is too old or too new for this app. */
    API_UNSUPPORTED,

    /** 503 read_only_mode: the server takes no changes for now; keep and retry. */
    READ_ONLY,

    /** 503 restoring: a restore is running; retry. */
    RESTORING,

    /** 507: the server's disk is almost full; keep and retry. */
    SERVER_FULL,

    /** 429: too many requests (rate_limited, slow_down); wait Retry-After. */
    RATE_LIMITED,

    /** 401 invalid_pairing_token: the code is wrong, expired or used. */
    INVALID_CODE,

    /** 410 link_expired: the link code expired, was refused or used. */
    LINK_EXPIRED,

    /** 404. */
    NOT_FOUND,

    /** 409. */
    CONFLICT,

    /** 410 other than link_expired (cursor_expired). */
    GONE,

    /** 413: too large (halve a point batch). */
    TOO_LARGE,

    /** 400 or 422: the request was refused as invalid. */
    INVALID,

    /** Other 5xx: retry later. */
    SERVER_ERROR,

    /** Anything else. */
    OTHER,
    ;

    companion object {
        fun of(status: Int, code: String): ApiFailure = when {
            code == ApiCodes.NETWORK -> UNREACHABLE
            code == ApiCodes.INSECURE_ADDRESS -> INSECURE_ADDRESS
            code == ApiCodes.WRONG_SERVER -> WRONG_SERVER
            code == ApiCodes.NOT_MILEWAGE -> NOT_MILEWAGE
            code == ApiCodes.BAD_RESPONSE -> BAD_RESPONSE
            code == ApiCodes.API_UNSUPPORTED -> API_UNSUPPORTED
            code == ApiCodes.UPGRADE_REQUIRED || status == 426 -> APP_TOO_OLD
            status == 401 && code == ApiCodes.DEVICE_REVOKED -> REVOKED
            status == 401 && code == ApiCodes.INVALID_PAIRING_TOKEN -> INVALID_CODE
            status == 401 -> UNAUTHORIZED
            status == 403 -> FORBIDDEN
            code == ApiCodes.READ_ONLY_MODE -> READ_ONLY
            code == ApiCodes.RESTORING -> RESTORING
            status == 507 || code == ApiCodes.INSUFFICIENT_STORAGE -> SERVER_FULL
            status == 429 -> RATE_LIMITED
            status == 410 && code == ApiCodes.LINK_EXPIRED -> LINK_EXPIRED
            status == 410 -> GONE
            status == 404 -> NOT_FOUND
            status == 409 -> CONFLICT
            status == 413 -> TOO_LARGE
            status == 400 || status == 422 -> INVALID
            status >= 500 -> SERVER_ERROR
            else -> OTHER
        }
    }
}
