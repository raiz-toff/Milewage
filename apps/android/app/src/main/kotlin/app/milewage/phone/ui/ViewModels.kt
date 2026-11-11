package app.milewage.phone.ui

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import app.milewage.phone.AppGraph
import app.milewage.phone.MileWageApp
import app.milewage.phone.ui.detail.ShiftDetailViewModel
import app.milewage.phone.ui.diagnostics.DiagnosticsViewModel
import app.milewage.phone.ui.firstrun.ConnectViewModel
import app.milewage.phone.ui.firstrun.SetupViewModel
import app.milewage.phone.ui.firstrun.TailscaleViewModel
import app.milewage.phone.ui.settings.SettingsViewModel
import app.milewage.phone.ui.home.HomeViewModel
import app.milewage.phone.ui.nav.AppViewModel
import app.milewage.phone.ui.shifts.ShiftsViewModel

/**
 * Every view model's factory, reading the service locator ([AppGraph]) from the Application. The
 * view models take only seams (`ShiftData`, `TrackingView`, `Now`, `PairingPort`, `NetView`, ...), so
 * their tests use fakes.
 */
object ViewModels {
    private val CreationExtras.graph: AppGraph get() = (this[APPLICATION_KEY] as MileWageApp).graph

    fun app(): ViewModelProvider.Factory = viewModelFactory {
        initializer { graph.let { g -> AppViewModel(g.shiftData, g.pairingPort, g.links) } }
    }

    fun connect(): ViewModelProvider.Factory = viewModelFactory {
        initializer { graph.let { g -> ConnectViewModel(g.pairingPort, g.netView, g.links.pending, g.links::consume, g.release) } }
    }

    fun tailscale(): ViewModelProvider.Factory = viewModelFactory {
        initializer { graph.let { g -> TailscaleViewModel(g.netView) } }
    }

    fun setup(): ViewModelProvider.Factory = viewModelFactory {
        initializer { graph.let { g -> SetupViewModel(g.pairingPort, g.shiftData) } }
    }

    fun settings(): ViewModelProvider.Factory = viewModelFactory {
        initializer { graph.let { g -> SettingsViewModel(g.pairingPort, g.netView, g.shiftData, g.trackingSettings, g.appearance) } }
    }

    fun home(): ViewModelProvider.Factory = viewModelFactory {
        initializer { graph.let { g -> HomeViewModel(g.shiftData, g.trackingView, g.now) } }
    }

    fun shifts(): ViewModelProvider.Factory = viewModelFactory {
        initializer { graph.let { g -> ShiftsViewModel(g.shiftData, g.now) } }
    }

    fun detail(clientId: String): ViewModelProvider.Factory = viewModelFactory {
        initializer { graph.let { g -> ShiftDetailViewModel(clientId, g.shiftData) } }
    }

    fun diagnostics(): ViewModelProvider.Factory = viewModelFactory {
        initializer { graph.let { g -> DiagnosticsViewModel(g.diagnosticsSource) } }
    }
}
