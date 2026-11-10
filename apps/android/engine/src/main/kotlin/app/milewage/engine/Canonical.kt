// Port of packages/track-engine/src/canonical.ts.
// Canonical JSON for engine results (14 section 10.1): keys sorted by UTF-16 code unit,
// no whitespace, absent (undefined) members omitted, integers only. Two engines that agree on a
// result produce the same bytes, so a byte comparison is the conformance test. Written by hand,
// not by a JSON library, so the bytes are exactly JSON.stringify's.
package app.milewage.engine

/** A JSON value as canonicalJson sees it. Absent members are simply not in [Obj.members]. */
sealed interface CanonicalValue {
    data object Null : CanonicalValue

    data class Bool(val value: Boolean) : CanonicalValue

    data class Num(val value: Long) : CanonicalValue

    data class Str(val value: String) : CanonicalValue

    data class Arr(val items: List<CanonicalValue>) : CanonicalValue

    data class Obj(val members: Map<String, CanonicalValue>) : CanonicalValue
}

/** Number.MAX_SAFE_INTEGER. */
const val MAX_SAFE_INTEGER: Long = 9_007_199_254_740_991L

fun canonicalJson(value: CanonicalValue): String = StringBuilder().also { write(it, value) }.toString()

fun canonicalJson(result: ShiftResult): String = canonicalJson(result.toCanonical())

private fun write(sb: StringBuilder, value: CanonicalValue) {
    when (value) {
        CanonicalValue.Null -> sb.append("null")
        is CanonicalValue.Bool -> sb.append(if (value.value) "true" else "false")
        is CanonicalValue.Num -> {
            if (value.value > MAX_SAFE_INTEGER || value.value < -MAX_SAFE_INTEGER) {
                throw IllegalArgumentException("canonicalJson: ${value.value} is not a safe integer")
            }
            sb.append(value.value)
        }
        is CanonicalValue.Str -> jsonString(sb, value.value)
        is CanonicalValue.Arr -> {
            sb.append('[')
            value.items.forEachIndexed { i, v ->
                if (i > 0) sb.append(',')
                write(sb, v)
            }
            sb.append(']')
        }
        is CanonicalValue.Obj -> {
            sb.append('{')
            value.members.keys.sortedWith(::cmp).forEachIndexed { i, k ->
                if (i > 0) sb.append(',')
                jsonString(sb, k)
                sb.append(':')
                write(sb, value.members.getValue(k))
            }
            sb.append('}')
        }
    }
}

private const val HEX = "0123456789abcdef"

private fun appendU(sb: StringBuilder, c: Int) {
    sb.append("\\u")
    sb.append(HEX[(c shr 12) and 0xf]).append(HEX[(c shr 8) and 0xf]).append(HEX[(c shr 4) and 0xf]).append(HEX[c and 0xf])
}

/**
 * `JSON.stringify(string)` (ES2019 well-formed): `"` and `\` escaped, \b \t \n \f \r by name,
 * other controls below 0x20 and lone surrogates as lowercase `\u00xx`; everything else as is
 * (including DEL, U+2028 and U+2029).
 */
internal fun jsonString(sb: StringBuilder, s: String) {
    sb.append('"')
    var i = 0
    val n = s.length
    while (i < n) {
        val ch = s[i]
        val c = ch.code
        when {
            ch == '"' -> sb.append("\\\"")
            ch == '\\' -> sb.append("\\\\")
            c == 0x08 -> sb.append("\\b")
            c == 0x09 -> sb.append("\\t")
            c == 0x0a -> sb.append("\\n")
            c == 0x0c -> sb.append("\\f")
            c == 0x0d -> sb.append("\\r")
            c < 0x20 -> appendU(sb, c)
            ch.isHighSurrogate() -> {
                if (i + 1 < n && s[i + 1].isLowSurrogate()) {
                    sb.append(ch).append(s[i + 1])
                    i++
                } else {
                    appendU(sb, c)
                }
            }
            ch.isLowSurrogate() -> appendU(sb, c)
            else -> sb.append(ch)
        }
        i++
    }
    sb.append('"')
}

private fun num(v: Long) = CanonicalValue.Num(v)

private fun num(v: Int) = CanonicalValue.Num(v.toLong())

private fun str(v: String) = CanonicalValue.Str(v)

private fun obj(vararg members: Pair<String, CanonicalValue?>): CanonicalValue.Obj =
    CanonicalValue.Obj(members.filter { it.second != null }.associate { it.first to it.second!! })

fun Trip.toCanonical(): CanonicalValue = obj(
    "tripKey" to str(tripKey),
    "kind" to str(kind.wire),
    "originalKind" to str(originalKind.wire),
    "startedAt" to num(startedAt),
    "endedAt" to num(endedAt),
    "startLatE7" to num(startLatE7),
    "startLonE7" to num(startLonE7),
    "endLatE7" to num(endLatE7),
    "endLonE7" to num(endLonE7),
    "distanceM" to num(distanceM),
    "purpose" to str(purpose),
)

fun Stop.toCanonical(): CanonicalValue = obj(
    "stopKey" to str(stopKey),
    "startedAt" to num(startedAt),
    "endedAt" to num(endedAt),
    "dwellS" to num(dwellS),
    "latE7" to num(latE7),
    "lonE7" to num(lonE7),
    "confidence" to str(confidence.wire),
    "estRole" to str(estRole.wire),
    "role" to str(role.wire),
)

fun Flag.toCanonical(): CanonicalValue = obj(
    "code" to str(code.wire),
    "at" to at?.let(::num),
    "detail" to detail?.let(::str),
)

fun RoutePoint.toCanonical(): CanonicalValue = obj("latE7" to num(latE7), "lonE7" to num(lonE7), "t" to num(t))

fun ShiftResult.toCanonical(): CanonicalValue = obj(
    "algorithmVersion" to num(algorithmVersion),
    "inputDigest" to str(inputDigest),
    "totals" to obj(
        "totalM" to num(totals.totalM),
        "activeM" to num(totals.activeM),
        "deadheadM" to num(totals.deadheadM),
        "personalM" to num(totals.personalM),
    ),
    "trips" to CanonicalValue.Arr(trips.map { it.toCanonical() }),
    "stops" to CanonicalValue.Arr(stops.map { it.toCanonical() }),
    "route" to CanonicalValue.Arr(route.map { it.toCanonical() }),
    "flags" to CanonicalValue.Arr(flags.map { it.toCanonical() }),
    "stats" to CanonicalValue.Obj(stats.mapValues { num(it.value) }),
)
