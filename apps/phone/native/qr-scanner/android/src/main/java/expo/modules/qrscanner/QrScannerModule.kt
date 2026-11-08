package expo.modules.qrscanner

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** A QR scanner view on ZXing, without Google ML Kit or Play services (plan 24 section 6, Q1). */
class QrScannerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("QrScanner")
    View(QrScannerView::class) {
      Events("onScanned")
      Prop("torch") { view: QrScannerView, on: Boolean -> view.setTorch(on) }
    }
  }
}
