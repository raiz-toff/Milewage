// Port of packages/track-engine/src/digest.ts.
// inputDigest (14 section 9.2): 64-bit FNV-1a over a canonical text of the effective input.
// A consistency check, not security.
package app.milewage.engine

private const val FNV_OFFSET: ULong = 0xcbf29ce484222325UL
private const val FNV_PRIME: ULong = 0x100000001b3UL // 2^40 + 0x1b3

/**
 * The TypeScript computes FNV-1a 64 with two 32-bit halves on doubles; that is exactly
 * multiplication modulo 2^64, which ULong does natively. The bytes are NOT UTF-8: each UTF-16
 * code unit below 0x80 is one byte, any other unit is two bytes, low then high (`charCodeAt`).
 * Kotlin strings are UTF-16 on every platform, so `text[i].code` is `charCodeAt(i)`.
 */
fun fnv1a64Hex(text: String): String {
    var h = FNV_OFFSET
    fun step(byte: Int) {
        h = (h xor byte.toULong()) * FNV_PRIME
    }
    for (i in text.indices) {
        val c = text[i].code
        if (c < 0x80) {
            step(c)
        } else {
            step(c and 0xff)
            step(c ushr 8)
        }
    }
    return h.toString(16).padStart(16, '0')
}

/**
 * Canonical text of what the totals, trips and stops depend on. Fixes are the normalized
 * set (stage 1: sorted, de-duplicated, in the window), so a retried upload or a reordered
 * list gives the same digest. Flag-only inputs (autoClosed, clockSkewMs) are not included.
 * Numbers print as JavaScript prints an integer below 2^53 (Long.toString is the same).
 */
fun canonicalInputText(input: ShiftInput, normalized: List<Fix>): String {
    val lines = ArrayList<String>()
    lines.add("v1")
    lines.add("shift:${input.shiftClientId},${input.startedAt},${input.endedAt}")
    lines.add("segmenter:${input.segmenter.wire}")
    for (f in normalized) {
        lines.add("f:${f.seq},${f.recordedAt},${f.latE7},${f.lonE7},${f.accuracyM}")
    }
    val labels = input.stopLabels.sortedWith { a, b ->
        val c = cmp(a.stopKey, b.stopKey)
        if (c != 0) c else cmp(a.role.wire, b.role.wire)
    }
    for (l in labels) lines.add("l:${l.stopKey},${l.role.wire}")
    val ints = input.interruptions.sortedWith { a, b ->
        val c = a.fromMs.compareTo(b.fromMs)
        if (c != 0) c else a.toMs.compareTo(b.toMs)
    }
    for (i in ints) lines.add("i:${i.fromMs},${i.toMs}")
    for (e in sortEdits(input.edits)) lines.add("e:${e.tripKey},${e.kind?.wire ?: ""},${e.purpose ?: ""}")
    return lines.joinToString("\n")
}

fun inputDigest(input: ShiftInput, normalized: List<Fix>): String = fnv1a64Hex(canonicalInputText(input, normalized))
