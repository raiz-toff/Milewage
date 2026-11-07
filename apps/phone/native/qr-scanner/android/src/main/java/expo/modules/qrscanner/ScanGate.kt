package expo.modules.qrscanner

/**
 * The camera decodes many frames a second, so the same code arrives again and again. A code is
 * passed on once, and again only after [repeatMs] (the driver may aim at it a second time after
 * a "wrong code" message). Blank text is never passed on.
 */
class ScanGate(private val repeatMs: Long = 2_000) {
  private var last: String? = null
  private var lastAt = 0L

  fun accept(text: String?, nowMs: Long): Boolean {
    val t = text?.trim().orEmpty()
    if (t.isEmpty()) return false
    if (t == last && nowMs - lastAt < repeatMs) return false
    last = t
    lastAt = nowMs
    return true
  }
}
