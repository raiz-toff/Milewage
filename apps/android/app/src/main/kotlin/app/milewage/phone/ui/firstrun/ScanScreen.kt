package app.milewage.phone.ui.firstrun

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.compose.CameraXViewfinder
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.SurfaceRequest
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.lifecycle.awaitInstance
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size as GeoSize
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.milewage.data.qr.QrFrameAnalyzer
import app.milewage.phone.R
import app.milewage.phone.logic.ScanResult
import app.milewage.phone.platform.ActivityPermissions
import app.milewage.phone.platform.SystemScreens
import app.milewage.phone.ui.components.BrandButton
import app.milewage.phone.ui.icons.Icons
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import java.util.concurrent.Executors

/** What the scanner shows: the camera, or why it cannot. */
enum class CameraAccess { CHECKING, GRANTED, DENIED, BLOCKED, FAILED }

/**
 * The pairing QR scanner (09 section 5.3: CAMERA is used here and nowhere else; no microphone).
 * CameraX through `camera-compose` (its `CameraXViewfinder`, stable since CameraX 1.5) with a
 * Preview and an ImageAnalysis feeding `:data`'s [QrFrameAnalyzer] (ZXing; no ML Kit). Camera
 * permission is asked here, in context; refused, the screen says so and offers to ask again (or the
 * app's settings once Android stops asking) and to paste the code instead. A code is read once:
 * analysis stops, the phone ticks, and the code goes to Connect.
 */
@Composable
fun ScanRoute(onCode: (String) -> Unit, onClose: () -> Unit, onPasteInstead: () -> Unit) {
    val context = LocalContext.current
    val prefs = remember(context) { context.getSharedPreferences(ActivityPermissions.PREFS, Context.MODE_PRIVATE) }
    var access by remember { mutableStateOf(CameraAccess.CHECKING) }
    var asked by rememberSaveable { mutableStateOf(false) }
    fun read() {
        access = when {
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED -> CameraAccess.GRANTED
            !prefs.getBoolean(CAMERA_ASKED, false) -> CameraAccess.DENIED
            ActivityPermissions.rationale(context, Manifest.permission.CAMERA) -> CameraAccess.DENIED
            else -> CameraAccess.BLOCKED
        }
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { read() }
    fun ask() {
        prefs.edit { putBoolean(CAMERA_ASKED, true) }
        launcher.launch(Manifest.permission.CAMERA)
    }
    // Back from the app's settings: look again.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { if (access != CameraAccess.FAILED) read() }
    LaunchedEffect(Unit) {
        read()
        // The first time here, ask at once: the driver tapped "Scan the code", which says the camera is needed.
        if (access == CameraAccess.DENIED && !asked) {
            asked = true
            ask()
        }
    }

    var torch by rememberSaveable { mutableStateOf(false) }
    var wrong by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    val hits = remember { Channel<String>(Channel.CONFLATED) }
    var done by remember { mutableStateOf(false) }
    val code by rememberUpdatedState(onCode)
    LaunchedEffect(hits) {
        for (text in hits) {
            if (done) continue
            when (val r = ScanResult.of(text)) {
                is ScanResult.Code -> {
                    done = true
                    haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                    code(r.text)
                }
                ScanResult.Stray -> {
                    haptics.performHapticFeedback(HapticFeedbackType.Reject)
                    wrong = true
                }
            }
        }
    }
    LaunchedEffect(wrong) {
        if (wrong) {
            // Let the driver aim at the right code; the gate passes the same stray code again after 2 s.
            delay(2_000)
            wrong = false
        }
    }

    ScanContent(
        access = access,
        torch = torch,
        wrongCode = wrong,
        onClose = onClose,
        onTorch = { torch = !torch },
        onAsk = ::ask,
        onSettings = { SystemScreens.appSettings(context) },
        onPasteInstead = onPasteInstead,
        camera = {
            CameraPreview(
                torch = torch,
                paused = done,
                onText = { hits.trySend(it) },
                onFailed = { access = CameraAccess.FAILED },
            )
        },
    )
}

private const val CAMERA_ASKED = "camera_asked"

/**
 * The camera bound to this screen's lifecycle (it stops when the screen leaves or the app goes to
 * the background): a Preview into [CameraXViewfinder] and an ImageAnalysis (latest frame only,
 * about 1280 x 720, enough for a code on a screen) running [QrFrameAnalyzer] on its own thread.
 */
@Composable
private fun CameraPreview(torch: Boolean, paused: Boolean, onText: (String) -> Unit, onFailed: () -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var request by remember { mutableStateOf<SurfaceRequest?>(null) }
    var camera by remember { mutableStateOf<Camera?>(null) }
    val text by rememberUpdatedState(onText)
    val failed by rememberUpdatedState(onFailed)
    val analysis = remember {
        ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setResolutionSelector(
                ResolutionSelector.Builder()
                    .setResolutionStrategy(ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                    .build(),
            )
            .build()
    }
    val executor = remember { Executors.newSingleThreadExecutor() }
    DisposableEffect(Unit) { onDispose { executor.shutdown() } }
    LaunchedEffect(paused) {
        // After a code: no more frames are analysed.
        if (paused) analysis.clearAnalyzer() else analysis.setAnalyzer(executor, QrFrameAnalyzer { text(it) })
    }
    LaunchedEffect(owner) {
        val preview = Preview.Builder().build().apply { setSurfaceProvider { request = it } }
        val provider = try {
            ProcessCameraProvider.awaitInstance(context)
        } catch (e: IllegalStateException) {
            failed()
            return@LaunchedEffect
        }
        try {
            camera = provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        } catch (e: IllegalArgumentException) {
            // No back camera on this phone.
            failed()
            return@LaunchedEffect
        } catch (e: IllegalStateException) {
            failed()
            return@LaunchedEffect
        }
        try {
            awaitCancellation()
        } finally {
            provider.unbind(preview, analysis)
            camera = null
        }
    }
    LaunchedEffect(camera, torch) {
        val c = camera ?: return@LaunchedEffect
        if (c.cameraInfo.hasFlashUnit()) c.cameraControl.enableTorch(torch)
    }
    request?.let { CameraXViewfinder(surfaceRequest = it, modifier = Modifier.fillMaxSize()) }
}

/** The scanner's look, for any [access]: the camera behind a frame, or the reason it is not there. */
@Composable
fun ScanContent(
    access: CameraAccess,
    torch: Boolean,
    wrongCode: Boolean,
    onClose: () -> Unit,
    onTorch: () -> Unit,
    onAsk: () -> Unit,
    onSettings: () -> Unit,
    onPasteInstead: () -> Unit,
    camera: @Composable () -> Unit,
) {
    // The camera image sits on the theme's scrim (black); the controls float on it.
    Surface(color = MaterialTheme.colorScheme.scrim, modifier = Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize()) {
            if (access == CameraAccess.GRANTED) camera()
            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    FilledTonalIconButton(onClick = onClose, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Close, contentDescription = stringResource(R.string.scan_close))
                    }
                    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                        Text(
                            stringResource(R.string.scan_title),
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).semantics { heading() },
                        )
                    }
                    if (access == CameraAccess.GRANTED) {
                        FilledTonalIconButton(onClick = onTorch, modifier = Modifier.size(48.dp)) {
                            Icon(
                                if (torch) Icons.TorchOff else Icons.TorchOn,
                                contentDescription = stringResource(if (torch) R.string.scan_torch_off else R.string.scan_torch_on),
                            )
                        }
                    } else {
                        Box(Modifier.size(48.dp))
                    }
                }
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    if (access == CameraAccess.GRANTED) ScanFrame(wrongCode)
                }
                when (access) {
                    CameraAccess.GRANTED -> HintCard(wrongCode)
                    CameraAccess.CHECKING -> Unit
                    else -> NoCameraCard(access, onAsk, onSettings, onPasteInstead)
                }
            }
        }
    }
}

/** The viewfinder's corners: Lane yellow, or the error colour after a code that is not MileWage's. */
@Composable
private fun ScanFrame(wrong: Boolean) {
    val color: Color = if (wrong) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primaryContainer
    Canvas(Modifier.size(248.dp)) {
        val corner = 36.dp.toPx()
        val w = 4.dp.toPx()
        val r = 16.dp.toPx()
        val s = size.width
        val stroke = Stroke(width = w)
        // Each corner: a rounded square's corner, clipped to its quarter.
        listOf(Offset(0f, 0f), Offset(s - corner, 0f), Offset(0f, s - corner), Offset(s - corner, s - corner)).forEach { o ->
            val left = o.x == 0f
            val top = o.y == 0f
            clipRect(o.x, o.y, o.x + corner, o.y + corner) {
                drawRoundRect(
                    color = color,
                    topLeft = Offset(if (left) w / 2 else o.x - corner + w / 2, if (top) w / 2 else o.y - corner + w / 2),
                    size = GeoSize(corner * 2 - w, corner * 2 - w),
                    cornerRadius = CornerRadius(r, r),
                    style = stroke,
                )
            }
        }
    }
}

@Composable
private fun HintCard(wrong: Boolean) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (wrong) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
            contentColor = if (wrong) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurface,
        ),
        modifier = Modifier.fillMaxWidth().padding(16.dp).semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Text(
            stringResource(if (wrong) R.string.scan_wrong else R.string.scan_hint),
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(16.dp),
        )
    }
}

/** No camera: why, and the ways on (ask again or the settings page, and pasting the code). */
@Composable
private fun NoCameraCard(access: CameraAccess, onAsk: () -> Unit, onSettings: () -> Unit, onPasteInstead: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
        modifier = Modifier.fillMaxWidth().padding(16.dp).semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        Column(
            Modifier.padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.CameraOff, contentDescription = null)
                Text(
                    stringResource(
                        when (access) {
                            CameraAccess.BLOCKED -> R.string.camera_blocked_title
                            CameraAccess.FAILED -> R.string.camera_failed_title
                            else -> R.string.camera_needed_title
                        },
                    ),
                    style = MaterialTheme.typography.titleMedium,
                )
            }
            Text(
                stringResource(
                    when (access) {
                        CameraAccess.BLOCKED -> R.string.camera_blocked_body
                        CameraAccess.FAILED -> R.string.camera_failed_body
                        else -> R.string.camera_needed_body
                    },
                ),
                style = MaterialTheme.typography.bodyMedium,
            )
            when (access) {
                CameraAccess.DENIED -> BrandButton(stringResource(R.string.camera_allow), onAsk, Modifier.fillMaxWidth())
                CameraAccess.BLOCKED -> BrandButton(stringResource(R.string.open_app_settings), onSettings, Modifier.fillMaxWidth())
                else -> Unit
            }
            TextButton(onClick = onPasteInstead, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(stringResource(R.string.paste_instead))
            }
        }
    }
}

/** A dark stand-in for the camera image in previews and screenshots. */
@Composable
fun CameraStandIn() {
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.inverseSurface))
}
