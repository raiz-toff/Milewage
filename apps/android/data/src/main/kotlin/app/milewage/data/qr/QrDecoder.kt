package app.milewage.data.qr

import com.google.zxing.BinaryBitmap
import com.google.zxing.ChecksumException
import com.google.zxing.DecodeHintType
import com.google.zxing.FormatException
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

/**
 * Reads one QR code from a grey-scale frame with ZXing (`com.google.zxing:core`, Apache-2.0, the
 * open-source ZXing project: a plain Java library, not Google Play Services or ML Kit; decision
 * 2026-11-07). The frame is the camera's luminance plane (the Y plane of YUV_420_888, what CameraX
 * ImageAnalysis delivers by default): one byte per pixel, rows [rowStride] bytes apart. QR codes read
 * at any rotation, so the frame is used as the sensor gives it.
 *
 * Not thread-safe (the reader keeps state): one decoder per analyzer, which CameraX calls on one thread.
 */
class QrDecoder {
    private val reader = QRCodeReader()
    private val hints = mapOf(DecodeHintType.CHARACTER_SET to "UTF-8")

    /** The code's text, or null when the frame holds no readable QR code. */
    fun decode(luminance: ByteArray, width: Int, height: Int, rowStride: Int = width): String? {
        require(width > 0 && height > 0 && rowStride >= width) { "bad frame $width x $height, stride $rowStride" }
        require(luminance.size >= rowStride * (height - 1) + width) { "frame too short" }
        val source = PlanarYUVLuminanceSource(luminance, rowStride, height, 0, 0, width, height, false)
        return try {
            reader.decode(BinaryBitmap(HybridBinarizer(source)), hints).text
        } catch (_: NotFoundException) {
            null
        } catch (_: ChecksumException) {
            null
        } catch (_: FormatException) {
            null
        } finally {
            reader.reset()
        }
    }
}
