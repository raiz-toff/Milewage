package expo.modules.qrscanner

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeWriter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanGateTest {
  @Test
  fun passesACodeOnceThenAgainAfterThePause() {
    val g = ScanGate(repeatMs = 2_000)
    assertTrue(g.accept("milewage://pair?v=1", 0))
    assertFalse(g.accept("milewage://pair?v=1", 500))
    assertFalse(g.accept(" milewage://pair?v=1 ", 1_999))
    assertTrue(g.accept("milewage://pair?v=1", 2_000))
    assertTrue(g.accept("https://other", 2_100)) // a different code at once
  }

  @Test
  fun neverPassesBlankText() {
    val g = ScanGate()
    assertFalse(g.accept(null, 0))
    assertFalse(g.accept("  ", 0))
  }

  /** The decoder in the app is plain ZXing: a pairing QR made here reads back exactly. */
  @Test
  fun zxingReadsAPairingCode() {
    val text = "milewage://pair?v=1&u=https%3A%2F%2Fbox.tail1234.ts.net&t=mwp_" + "a".repeat(43)
    val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 300, 300)
    val px = IntArray(m.width * m.height) { i ->
      if (m.get(i % m.width, i / m.width)) 0xFF000000.toInt() else -1
    }
    val bitmap = BinaryBitmap(HybridBinarizer(RGBLuminanceSource(m.width, m.height, px)))
    val hints = mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE))
    assertEquals(text, MultiFormatReader().decode(bitmap, hints).text)
  }
}
