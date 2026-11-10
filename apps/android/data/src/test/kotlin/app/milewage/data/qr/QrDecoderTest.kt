package app.milewage.data.qr

import android.graphics.ImageFormat
import android.graphics.Rect
import android.media.Image
import androidx.camera.core.ImageInfo
import androidx.camera.core.ImageProxy
import app.milewage.core.pairing.PairingLink
import app.milewage.core.pairing.PairingLinks
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.nio.ByteBuffer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** QR codes made here with ZXing's writer, read back from grey-scale frames as the camera gives them. */
class QrDecoderTest {
    private val token = "mwp_" + "a".repeat(43)
    private val link = PairingLinks.links(PairingLink("https://box.tail1234.ts.net", token, "http://192.168.1.20:8080")).second

    /** A frame [w] x [h] (rows [stride] apart) with the QR for [text] drawn [size] px wide at ([x], [y]). */
    private fun frame(text: String, w: Int = 640, h: Int = 480, stride: Int = w, size: Int = 300, x: Int = 170, y: Int = 90, rotate: Boolean = false): ByteArray {
        val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 2))
        val out = ByteArray(stride * h) { 0xD0.toByte() } // a light grey wall
        for (r in 0 until m.height) for (c in 0 until m.width) {
            val (px, py) = if (rotate) (x + (m.height - 1 - r)) to (y + c) else (x + c) to (y + r)
            if (px < w && py < h) out[py * stride + px] = if (m.get(c, r)) 0x10 else 0xF0.toByte()
        }
        return out
    }

    @Test
    fun readsAPairingCodeBackExactly() {
        val text = QrDecoder().decode(frame(link), 640, 480)
        assertEquals(link, text)
        assertEquals(PairingLink("https://box.tail1234.ts.net", token, "http://192.168.1.20:8080"), PairingLinks.parse(text!!))
    }

    @Test
    fun readsTheAppLinkFormRotatedAndWithPaddedRows() {
        val app = PairingLinks.links(PairingLink("https://mw.example.net", token)).first
        assertEquals(app, QrDecoder().decode(frame(app, rotate = true), 640, 480))
        assertEquals(app, QrDecoder().decode(frame(app, stride = 704), 640, 480, rowStride = 704))
    }

    @Test
    fun aFrameWithoutACodeIsNull() {
        val empty = ByteArray(640 * 480) { (it % 251).toByte() }
        assertNull(QrDecoder().decode(empty, 640, 480))
        assertNull(QrDecoder().decode(ByteArray(640 * 480), 640, 480))
    }

    @Test
    fun oneDecoderReadsFrameAfterFrame() {
        val d = QrDecoder()
        repeat(3) { assertEquals("milewage://pair?v=1&n=$it", d.decode(frame("milewage://pair?v=1&n=$it"), 640, 480)) }
    }

    // ---- the CameraX analyzer

    private class FakeFrame(private val bytes: ByteArray, private val w: Int, private val h: Int, private val stride: Int, private val format: Int = ImageFormat.YUV_420_888) : ImageProxy {
        var closed = false
        private val plane = object : ImageProxy.PlaneProxy {
            override fun getRowStride() = stride
            override fun getPixelStride() = 1
            override fun getBuffer(): ByteBuffer = ByteBuffer.wrap(bytes)
        }

        override fun close() {
            closed = true
        }

        override fun getCropRect(): Rect = throw UnsupportedOperationException()
        override fun setCropRect(rect: Rect?) = throw UnsupportedOperationException()
        override fun getFormat() = format
        override fun getHeight() = h
        override fun getWidth() = w
        override fun getPlanes(): Array<ImageProxy.PlaneProxy> = arrayOf(plane)
        override fun getImageInfo(): ImageInfo = throw UnsupportedOperationException()
        override fun getImage(): Image? = null
    }

    @Test
    fun theAnalyzerHandsACodeOnOnceAndClosesEveryFrame() {
        var now = 0L
        val seen = mutableListOf<String>()
        val analyzer = QrFrameAnalyzer(now = { now }) { seen += it }
        val frames = List(3) { FakeFrame(frame(link, stride = 672), 640, 480, 672) }
        frames.forEach { analyzer.analyze(it); now += 100 }
        assertEquals(listOf(link), seen) // the same code again only after the pause
        now += 2_000
        analyzer.analyze(FakeFrame(frame(link), 640, 480, 640))
        assertEquals(2, seen.size)
        val other = FakeFrame(frame(link), 640, 480, 640, format = ImageFormat.JPEG)
        analyzer.analyze(other)
        val blank = FakeFrame(ByteArray(640 * 480), 640, 480, 640)
        analyzer.analyze(blank)
        assertEquals(2, seen.size)
        assertTrue((frames + other + blank).all { it.closed })
    }
}
