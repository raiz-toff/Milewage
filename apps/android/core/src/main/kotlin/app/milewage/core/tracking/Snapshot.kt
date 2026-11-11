package app.milewage.core.tracking

/**
 * A tiny text format for the state that must survive process death (the stillness monitor,
 * the notification details). One `key=value` per line; a backslash and a line break in a
 * value are escaped. Plain Kotlin, so it moves to Kotlin Multiplatform as is, and a decoder that
 * meets a damaged or older snapshot falls back to defaults instead of throwing.
 */
class Snapshot private constructor(private val values: Map<String, String>) {
    fun string(key: String): String? = values[key]

    fun long(key: String): Long? = values[key]?.toLongOrNull()

    fun int(key: String): Int? = values[key]?.toIntOrNull()

    fun double(key: String): Double? = values[key]?.toDoubleOrNull()

    fun bool(key: String): Boolean? = when (values[key]) {
        "1" -> true
        "0" -> false
        else -> null
    }

    class Builder {
        private val values = LinkedHashMap<String, String>()

        fun put(key: String, value: Any?): Builder {
            require(KEY.matches(key)) { "bad key $key" }
            when (value) {
                null -> values.remove(key)
                is Boolean -> values[key] = if (value) "1" else "0"
                else -> values[key] = value.toString()
            }
            return this
        }

        fun encode(): String = values.entries.joinToString("\n") { (k, v) -> "$k=${escape(v)}" }
    }

    companion object {
        private val KEY = Regex("[A-Za-z][A-Za-z0-9_.]*")

        fun decode(text: String?): Snapshot {
            if (text.isNullOrEmpty()) return Snapshot(emptyMap())
            val map = LinkedHashMap<String, String>()
            for (line in text.split('\n')) {
                val i = line.indexOf('=')
                if (i <= 0) continue
                map[line.substring(0, i)] = unescape(line.substring(i + 1))
            }
            return Snapshot(map)
        }

        private fun escape(v: String) = v.replace("\\", "\\\\").replace("\n", "\\n")

        private fun unescape(v: String): String {
            val out = StringBuilder(v.length)
            var i = 0
            while (i < v.length) {
                val c = v[i]
                if (c == '\\' && i + 1 < v.length) {
                    out.append(if (v[i + 1] == 'n') '\n' else v[i + 1])
                    i += 2
                } else {
                    out.append(c)
                    i++
                }
            }
            return out.toString()
        }

        /** Samples as one value: fields joined by ',', samples by ';'. Unknown values are empty. */
        fun encodeSamples(list: List<Sample>): String = list.joinToString(";") { s ->
            val r = s.raw
            listOf(
                r.provider.filter { it.isLetterOrDigit() || it == '_' },
                r.timeMs, r.elapsedRealtimeMs, r.lat, r.lon, r.accuracyM, r.speedMps, r.bearingDeg, r.altitudeM, s.atMs,
            ).joinToString(",") { it?.toString() ?: "" }
        }

        /** The inverse of [encodeSamples]; a sample that does not parse is skipped. */
        fun decodeSamples(text: String?): List<Sample> {
            if (text.isNullOrEmpty()) return emptyList()
            return text.split(';').mapNotNull { item ->
                val f = item.split(',')
                if (f.size != 10) return@mapNotNull null
                val raw = RawLocation(
                    provider = f[0],
                    timeMs = f[1].toLongOrNull() ?: return@mapNotNull null,
                    elapsedRealtimeMs = f[2].toLongOrNull(),
                    lat = f[3].toDoubleOrNull() ?: return@mapNotNull null,
                    lon = f[4].toDoubleOrNull() ?: return@mapNotNull null,
                    accuracyM = f[5].toFloatOrNull(),
                    speedMps = f[6].toFloatOrNull(),
                    bearingDeg = f[7].toFloatOrNull(),
                    altitudeM = f[8].toDoubleOrNull(),
                )
                Sample(raw, f[9].toLongOrNull() ?: return@mapNotNull null)
            }
        }

        fun encodeSample(s: Sample?): String? = s?.let { encodeSamples(listOf(it)) }

        fun decodeSample(text: String?): Sample? = decodeSamples(text).firstOrNull()
    }
}
