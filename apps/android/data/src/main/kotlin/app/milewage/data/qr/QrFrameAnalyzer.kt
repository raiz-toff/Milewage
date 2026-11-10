package app.milewage.data.qr

import android.graphics.ImageFormat
import android.os.SystemClock
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import app.milewage.core.pairing.ScanGate

/**
 * The CameraX `ImageAnalysis.Analyzer` for the pairing QR: takes each frame's Y plane, decodes it
 * with [QrDecoder], and hands a code on through [ScanGate] (once, and again only after a pause).
 * The scan screen binds it with `ImageAnalysis.Builder().setBackpressureStrategy(STRATEGY_KEEP_ONLY_LATEST)`
 * (the default YUV_420_888 output) next to a Preview, and passes [onText] the text: it checks it with
 * `PairingLinks.parse` and says "That is not a MileWage pairing code." for a stray code.
 * Every frame is closed here, whatever happens.
 */
class QrFrameAnalyzer(
    private val decoder: QrDecoder = QrDecoder(),
    private val gate: ScanGate = ScanGate(),
    private val now: () -> Long = SystemClock::elapsedRealtime,
    private val onText: (String) -> Unit,
) : ImageAnalysis.Analyzer {
    private var frame = ByteArray(0)

    override fun analyze(image: ImageProxy) {
        image.use { img ->
            if (img.format != ImageFormat.YUV_420_888) return
            val plane = img.planes.firstOrNull() ?: return
            val width = img.width
            val height = img.height
            val luminance = copyLuminance(plane, width, height) ?: return
            val text = decoder.decode(luminance, width, height) ?: return
            if (gate.accept(text, now())) onText(text.trim())
        }
    }

    /** The Y plane as tight rows (`width` bytes each), reusing one buffer between frames. */
    private fun copyLuminance(plane: ImageProxy.PlaneProxy, width: Int, height: Int): ByteArray? {
        val buffer = plane.buffer.duplicate().apply { rewind() }
        val rowStride = plane.rowStride
        val pixelStride = plane.pixelStride
        if (frame.size != width * height) frame = ByteArray(width * height)
        val out = frame
        if (pixelStride == 1) {
            for (y in 0 until height) {
                val start = y * rowStride
                if (start + width > buffer.limit()) return null
                buffer.position(start)
                buffer.get(out, y * width, width)
            }
        } else {
            for (y in 0 until height) for (x in 0 until width) {
                val i = y * rowStride + x * pixelStride
                if (i >= buffer.limit()) return null
                out[y * width + x] = buffer.get(i)
            }
        }
        return out
    }
}
