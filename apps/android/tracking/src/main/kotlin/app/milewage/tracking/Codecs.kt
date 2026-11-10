package app.milewage.tracking

import app.milewage.core.tracking.Interruption
import app.milewage.core.tracking.InterruptionReason

/** Pure helpers of the Android layer, kept free of Android classes so they are JVM-tested. */
internal object Codecs {
    /** "from,to,REASON;..." */
    fun encodeInterruptions(list: List<Interruption>): String =
        list.joinToString(";") { "${it.fromMs},${it.toMs},${it.reason.name}" }

    /** The inverse of [encodeInterruptions]; an entry that does not parse is skipped. */
    fun decodeInterruptions(text: String?): List<Interruption> {
        if (text.isNullOrEmpty()) return emptyList()
        return text.split(';').mapNotNull { item ->
            val f = item.split(',')
            if (f.size != 3) return@mapNotNull null
            val from = f[0].toLongOrNull() ?: return@mapNotNull null
            val to = f[1].toLongOrNull() ?: return@mapNotNull null
            val reason = InterruptionReason.entries.firstOrNull { it.name == f[2] } ?: return@mapNotNull null
            if (to < from) null else Interruption(from, to, reason)
        }
    }

    /** The delay until a wake-up at [atMs]: never in the past, never sooner than [minMs] (no busy loop). */
    fun wakeDelayMs(atMs: Long, nowMs: Long, minMs: Long = 10_000L): Long = maxOf(minMs, atMs - nowMs)

    /** Whole minutes of the nudge time, for "You have not moved for 30 minutes." */
    fun minutes(ms: Long): Long = maxOf(1L, (ms + 30_000L) / 60_000L)
}
