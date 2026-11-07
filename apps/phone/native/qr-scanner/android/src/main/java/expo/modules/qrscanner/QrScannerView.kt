package expo.modules.qrscanner

import android.content.Context
import android.os.SystemClock
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeView
import com.journeyapps.barcodescanner.DefaultDecoderFactory
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** The camera preview, decoding QR codes only. The camera runs only while the view is shown. */
class QrScannerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  // The preview adds its surface itself, which React Native does not lay out.
  override val shouldUseAndroidLayout = true

  private val onScanned by EventDispatcher<Map<String, String>>()
  private val gate = ScanGate()
  private val camera = BarcodeView(appContext.currentActivity ?: context).apply {
    decoderFactory = DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE))
  }
  private val callback = BarcodeCallback { result ->
    val text = result.text
    if (gate.accept(text, SystemClock.elapsedRealtime())) onScanned(mapOf("text" to text.trim()))
  }

  init {
    addView(camera, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun setTorch(on: Boolean) = camera.setTorch(on)

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    camera.resume()
    camera.decodeContinuous(callback)
  }

  override fun onDetachedFromWindow() {
    camera.stopDecoding()
    camera.pause()
    super.onDetachedFromWindow()
  }
}
