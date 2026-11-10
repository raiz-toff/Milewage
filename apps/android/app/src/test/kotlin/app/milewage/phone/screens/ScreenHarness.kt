package app.milewage.phone.screens

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import app.milewage.core.sync.Reminder
import app.milewage.phone.logic.Fix
import app.milewage.phone.support.FixedNow
import app.milewage.phone.ui.components.LocalNow
import app.milewage.phone.ui.components.LocalSnackbars
import app.milewage.phone.ui.components.LocalTicking
import app.milewage.phone.ui.components.Snackbars
import app.milewage.phone.ui.home.HomeActions
import app.milewage.phone.ui.home.Period
import app.milewage.phone.ui.theme.MileWageTheme

/** A screen as the app shows it, with a fixed clock, nothing ticking, and an optional text scale. */
@Composable
fun Framed(dark: Boolean = false, fontScale: Float = 1f, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    CompositionLocalProvider(
        LocalTicking provides false,
        LocalNow provides FixedNow(),
        LocalSnackbars provides remember { Snackbars() },
        LocalDensity provides Density(density.density, fontScale),
    ) {
        MileWageTheme(darkTheme = dark) { content() }
    }
}

/** Records what Home's buttons were asked to do. */
class RecordingHomeActions : HomeActions {
    val calls = mutableListOf<String>()

    override fun start() {
        calls += "start"
    }

    override fun end() {
        calls += "end"
    }

    override fun closeUnfinished() {
        calls += "close"
    }

    override fun selectPeriod(p: Period) {
        calls += "period $p"
    }

    override fun selectVehicle(id: Long) {
        calls += "vehicle $id"
    }

    override fun refresh() {
        calls += "refresh"
    }

    override fun fix(f: Fix) {
        calls += "fix $f"
    }

    override fun saveOdometer(text: String) {
        calls += "odometer $text"
    }

    override fun skipOdometer() {
        calls += "skip"
    }

    override fun dismissOdometer() {
        calls += "dismiss"
    }

    override fun openDiagnostics() {
        calls += "diagnostics"
    }

    override fun reminderShown(level: Reminder.Level) {
        calls += "reminder $level"
    }
}
