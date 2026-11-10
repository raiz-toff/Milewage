package app.milewage.phone.ui.firstrun

import androidx.annotation.StringRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.milewage.core.connect.FoundServer
import app.milewage.core.shift.VehicleRecord
import app.milewage.phone.R
import app.milewage.phone.logic.ConnectFix
import app.milewage.phone.logic.Hosts
import app.milewage.phone.logic.Nearby
import app.milewage.phone.ui.Texts
import app.milewage.phone.ui.components.BottomAction
import app.milewage.phone.ui.components.BrandButton
import app.milewage.phone.ui.components.ListRow
import app.milewage.phone.ui.components.NoticeCard
import app.milewage.phone.ui.components.RowDivider
import app.milewage.phone.ui.components.Rows
import app.milewage.phone.ui.components.Screen
import app.milewage.phone.ui.components.ScreenPadding
import app.milewage.phone.ui.components.Tone
import app.milewage.phone.ui.components.tabular
import app.milewage.phone.ui.icons.Icons

/*
 * First run (24 section 4.2, plan 28): Welcome, Set up your server, Connect, Link, Tailscale, then
 * after connecting: Connected and Ready (the permissions screen is in ui/permissions). Each screen
 * renders a state and sends events back; the view models are in FirstRunViewModels.kt.
 */

/**
 * The first screen of a phone that is not paired: what MileWage is, where the data goes, and the
 * two ways on. [revoked]: the server disconnected this phone (it says so; unsent shifts stay).
 */
@Composable
fun WelcomeScreen(revoked: Boolean, onHaveServer: () -> Unit, onNoServer: () -> Unit) {
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().safeDrawingPadding()) {
            Column(
                modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
            ) {
                Image(painterResource(R.drawable.ic_coin_road), contentDescription = null, modifier = Modifier.size(96.dp))
                Text(
                    stringResource(R.string.welcome_title),
                    style = MaterialTheme.typography.headlineMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.semantics { heading() },
                )
                Text(stringResource(R.string.welcome_body), style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Privacy, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
                    Text(
                        stringResource(R.string.welcome_body_server),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (revoked) {
                    NoticeCard(
                        title = stringResource(R.string.welcome_revoked),
                        body = stringResource(R.string.welcome_revoked_detail),
                        icon = Icons.Warning,
                        tone = Tone.PROBLEM,
                    )
                }
            }
            Column(Modifier.padding(horizontal = 24.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                BrandButton(stringResource(R.string.welcome_have_server), onHaveServer, Modifier.fillMaxWidth())
                TextButton(onClick = onNoServer, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.welcome_no_server))
                }
            }
        }
    }
}

/** Numbered steps in a card: the server's setup, Tailscale's. */
@Composable
private fun NumberedSteps(steps: List<Pair<Int, Int>>) {
    Rows {
        steps.forEachIndexed { i, (title, detail) ->
            if (i > 0) RowDivider()
            val label = stringResource(R.string.step_number, i + 1)
            ListRow(
                headline = stringResource(title),
                supporting = stringResource(detail),
                leading = {
                    Box(
                        Modifier.size(32.dp).background(MaterialTheme.colorScheme.secondaryContainer, CircleShape)
                            .semantics { contentDescription = label },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "${i + 1}",
                            style = MaterialTheme.typography.labelLarge.tabular(),
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                        )
                    }
                },
            )
        }
    }
}

/** A paragraph under the top bar: what the screen is for. */
@Composable
private fun Lead(text: String) {
    Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

val SERVER_STEPS = listOf(
    R.string.server_step1_title to R.string.server_step1_detail,
    R.string.server_step2_title to R.string.server_step2_detail,
    R.string.server_step3_title to R.string.server_step3_detail,
    R.string.server_step4_title to R.string.server_step4_detail,
)

/** "I don't have one yet": the steps to do on a computer, sent there if the driver likes, then Connect. */
@Composable
fun ServerSetupScreen(onBack: () -> Unit, onShare: () -> Unit, onReady: () -> Unit) {
    Screen(
        title = stringResource(R.string.server_setup_title),
        onBack = onBack,
        bottomBar = { BottomAction { BrandButton(stringResource(R.string.server_setup_ready), onReady, Modifier.fillMaxWidth()) } },
    ) {
        item { Lead(stringResource(R.string.server_setup_body)) }
        item { NumberedSteps(SERVER_STEPS) }
        item {
            FilledTonalButton(onClick = onShare, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Icon(Icons.Share, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.size(8.dp))
                Text(stringResource(R.string.server_setup_share))
            }
        }
    }
}

/** What Connect's buttons do. */
interface ConnectActions {
    fun back()

    fun scan()

    fun submit(text: String)

    fun pick(server: FoundServer)

    fun lookAgain()

    fun tailscale()

    fun allowLocalNetwork()

    fun fix(fix: ConnectFix)

    fun dismissError()
}

/**
 * Connect this phone to the driver's server: on the home Wi-Fi it finds the server (then a 6-digit
 * code), or the QR code from the web's Devices page, or a link opened on this phone, or the code
 * (or the server's address) pasted by hand. The scanner is the main action.
 */
@Composable
fun ConnectContent(state: ConnectState, actions: ConnectActions) {
    var text by rememberSaveable { mutableStateOf("") }
    Screen(title = stringResource(R.string.connect_title), onBack = actions::back) {
        item { Lead(stringResource(R.string.connect_body)) }
        state.error?.let { e ->
            item(key = "error") {
                NoticeCard(
                    title = Texts.connectError(e),
                    icon = Icons.Error,
                    tone = Tone.PROBLEM,
                    actionLabel = stringResource(Texts.connectFix(e.fix)),
                    onAction = { actions.fix(e.fix) },
                    secondaryLabel = stringResource(R.string.dismiss),
                    onSecondary = actions::dismissError,
                )
            }
        }
        item(key = "nearby") { NearbyCard(state.nearby, actions) }
        item(key = "scan") {
            Section(Icons.QrScanner, R.string.scan_card_title, R.string.scan_card_body) {
                BrandButton(
                    text = stringResource(if (state.busy) R.string.connecting else R.string.scan_button),
                    onClick = actions::scan,
                    icon = Icons.QrScanner,
                    busy = state.busy,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        item(key = "link") { Section(Icons.Link, R.string.open_link_title, R.string.open_link_body) }
        item(key = "paste") {
            Section(Icons.Keyboard, R.string.paste_title, R.string.paste_body) {
                OutlinedTextField(
                    value = text,
                    onValueChange = {
                        text = it
                        if (state.error != null) actions.dismissError()
                    },
                    label = { Text(stringResource(R.string.paste_label)) },
                    placeholder = { Text(stringResource(R.string.paste_placeholder)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
                    keyboardActions = KeyboardActions(onGo = { if (text.isNotBlank()) actions.submit(text) }),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedButton(
                    onClick = { actions.submit(text) },
                    enabled = !state.busy && text.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) { Text(stringResource(if (state.busy) R.string.connecting else R.string.connect_button)) }
            }
        }
    }
}

/** A card with an icon, a title, a line and optional controls under them. */
@Composable
private fun Section(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    @StringRes title: Int,
    @StringRes body: Int,
    content: (@Composable () -> Unit)? = null,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(stringResource(title), style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
                    Text(stringResource(body), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            content?.invoke()
        }
    }
}

/** "On this Wi-Fi": the servers found, each a row that starts linking with a code. */
@Composable
private fun NearbyCard(nearby: Nearby, actions: ConnectActions) {
    val body = when (nearby) {
        is Nearby.OffWifi -> R.string.nearby_off_wifi
        Nearby.NeedsPermission -> R.string.nearby_permission
        else -> R.string.nearby_body
    }
    Section(Icons.Wifi, R.string.nearby_title, body) {
        when (nearby) {
            Nearby.Looking -> Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            ) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Text(stringResource(R.string.nearby_looking), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            is Nearby.Found -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (nearby.servers.isEmpty()) {
                    Text(stringResource(R.string.nearby_none), style = MaterialTheme.typography.bodyMedium)
                } else {
                    // On the card (surface-container-low) the rows sit one level up.
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
                        nearby.servers.forEachIndexed { i, s ->
                            if (i > 0) RowDivider()
                            ListRow(
                                headline = s.name,
                                supporting = Hosts.of(s.url) ?: s.url,
                                leading = { Icon(Icons.Server, contentDescription = null) },
                                trailing = { Icon(Icons.ChevronRight, contentDescription = null) },
                                onClick = { actions.pick(s) },
                                containerColor = MaterialTheme.colorScheme.surfaceContainer,
                            )
                        }
                    }
                }
                TextButton(onClick = actions::lookAgain, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.nearby_look_again)) }
            }
            is Nearby.OffWifi -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (nearby.tailscaleOff) {
                    OutlinedButton(onClick = actions::tailscale, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.nearby_tailscale)) }
                }
                TextButton(onClick = actions::lookAgain, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.nearby_look_again)) }
            }
            Nearby.NeedsPermission -> OutlinedButton(onClick = actions::allowLocalNetwork, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.perm_allow_local))
            }
        }
    }
}

/** Link this phone: the 6-digit code to type on the web while the phone waits, or what went wrong. */
@Composable
fun LinkContent(name: String, url: String, state: LinkState, onRetry: () -> Unit, onCancel: () -> Unit) {
    Screen(
        title = stringResource(R.string.link_title),
        subtitle = "$name · ${Hosts.of(url) ?: url}",
        onBack = onCancel,
        bottomBar = {
            BottomAction {
                OutlinedButton(onClick = onCancel, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text(stringResource(R.string.cancel)) }
            }
        },
    ) {
        when (state) {
            is LinkState.Failed -> item {
                NoticeCard(
                    title = stringResource(Texts.linkFailure(state.failure)),
                    icon = Icons.Error,
                    tone = Tone.PROBLEM,
                    actionLabel = stringResource(R.string.link_new_code),
                    onAction = onRetry,
                )
            }
            else -> item {
                val code = (state as? LinkState.Waiting)?.code
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(ScreenPadding), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text(stringResource(R.string.link_instructions), style = MaterialTheme.typography.bodyLarge)
                        if (code != null) {
                            // Read out digit by digit (voice reference: codes meant to be read aloud).
                            val spoken = stringResource(R.string.link_code_desc, code.toList().joinToString(" "))
                            Text(
                                "${code.take(3)} ${code.drop(3)}",
                                style = MaterialTheme.typography.displayMedium.tabular().copy(fontFamily = FontFamily.Monospace),
                                textAlign = TextAlign.Center,
                                modifier = Modifier.fillMaxWidth().semantics { contentDescription = spoken },
                            )
                        }
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
                            modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
                        ) {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            Text(
                                stringResource(if (code != null) R.string.link_waiting else R.string.link_asking),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

val TAILSCALE_STEPS = listOf(
    R.string.tailscale_step1_title to R.string.tailscale_step1_detail,
    R.string.tailscale_step2_title to R.string.tailscale_step2_detail,
    R.string.tailscale_step3_title to R.string.tailscale_step3_detail,
)

/**
 * Get Tailscale on this phone (24 section 4.2, screen 3; since plan 28 off the way to Connect: at
 * home the phone needs no Tailscale). Skippable: any https address works.
 */
@Composable
fun TailscaleContent(state: TailscaleState?, onOpen: () -> Unit, onContinue: () -> Unit, onBack: () -> Unit) {
    val ready = state?.ready == true
    Screen(
        title = stringResource(R.string.tailscale_title),
        onBack = onBack,
        bottomBar = {
            BottomAction {
                BrandButton(stringResource(if (ready) R.string.tailscale_continue else R.string.tailscale_continue_without), onContinue, Modifier.fillMaxWidth())
            }
        },
    ) {
        item { Lead(stringResource(R.string.tailscale_body)) }
        item { NumberedSteps(TAILSCALE_STEPS) }
        if (state != null) {
            item {
                if (ready) {
                    NoticeCard(title = stringResource(R.string.tailscale_ready), icon = Icons.CheckCircle)
                } else {
                    NoticeCard(
                        title = stringResource(if (state.installed) R.string.tailscale_not_connected else R.string.tailscale_not_installed),
                        icon = Icons.Tailscale,
                        actionLabel = stringResource(if (state.installed) R.string.tailscale_open else R.string.tailscale_install),
                        onAction = onOpen,
                    )
                }
            }
        }
        item {
            Text(stringResource(R.string.tailscale_https), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            Text(stringResource(R.string.tailscale_other), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/**
 * Connected (24 section 4.2, screen 5): which server (host names only), both addresses, what the
 * server sent, and the vehicles. A shift needs a vehicle: without one the driver adds it on the web
 * and checks again. [countryName]: a country code in words.
 */
@Composable
fun ConnectedContent(state: SetupState, countryName: (String) -> String, onCheck: () -> Unit, onNext: () -> Unit) {
    val f = state.facts
    Screen(
        title = stringResource(R.string.connected_title),
        bottomBar = { BottomAction { BrandButton(stringResource(R.string.next), onNext, Modifier.fillMaxWidth(), enabled = f != null) } },
    ) {
        item {
            Lead(
                when {
                    f == null -> stringResource(R.string.connected_reading)
                    f.name != null -> stringResource(R.string.connected_as, f.host, f.name)
                    else -> stringResource(R.string.connected_to, f.host)
                },
            )
        }
        if (f != null) {
            item(key = "server") {
                Rows(label = stringResource(R.string.settings_server)) {
                    ListRow(stringResource(R.string.row_home), supporting = f.homeHost ?: stringResource(R.string.not_set), leading = { Icon(Icons.Wifi, null) })
                    RowDivider()
                    ListRow(stringResource(R.string.row_away), supporting = f.awayHost ?: stringResource(R.string.away_not_set), leading = { Icon(Icons.Tailscale, null) })
                }
            }
            item(key = "sent") {
                Rows(label = stringResource(R.string.connected_sent)) {
                    ListRow(stringResource(R.string.row_country), supporting = f.country?.let(countryName) ?: stringResource(R.string.not_set))
                    RowDivider()
                    ListRow(stringResource(R.string.row_region), supporting = f.region ?: stringResource(R.string.not_set))
                    RowDivider()
                    ListRow(
                        stringResource(R.string.row_vehicles),
                        supporting = when {
                            state.checking -> stringResource(R.string.checking)
                            state.vehicles == null -> stringResource(R.string.vehicles_failed)
                            state.vehicles.isEmpty() -> stringResource(R.string.connected_vehicles_none)
                            else -> state.vehicles.joinToString(", ", transform = VehicleRecord::name)
                        },
                    )
                }
            }
            if (!state.checking && state.vehicles?.isEmpty() == true) {
                item(key = "novehicle") {
                    NoticeCard(
                        title = stringResource(R.string.connected_no_vehicle),
                        body = stringResource(R.string.connected_no_vehicle_detail),
                        icon = Icons.Vehicles,
                        tone = Tone.WARNING,
                        actionLabel = stringResource(R.string.check_again),
                        onAction = onCheck,
                    )
                }
            }
            if (!state.checking && state.vehicles == null) {
                item(key = "failed") {
                    NoticeCard(
                        title = stringResource(R.string.connected_vehicles_failed),
                        icon = Icons.Warning,
                        tone = Tone.WARNING,
                        actionLabel = stringResource(R.string.check_again),
                        onAction = onCheck,
                    )
                }
            }
            if (f.homeOnly) {
                item(key = "homeonly") {
                    NoticeCard(title = stringResource(R.string.home_only_title), body = stringResource(R.string.home_only_detail), icon = Icons.Wifi)
                }
            }
            if (!state.checking && !state.vehicles.isNullOrEmpty()) {
                item(key = "ready") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                        Text(stringResource(R.string.connected_ready), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

/** The last setup step (24 section 4.2, screen 10). Anything skipped stays on Home's checklist. */
@Composable
fun ReadyContent(onGo: () -> Unit) {
    Screen(
        title = stringResource(R.string.ready_title),
        bottomBar = { BottomAction { BrandButton(stringResource(R.string.ready_go), onGo, Modifier.fillMaxWidth()) } },
    ) {
        item { Lead(stringResource(R.string.ready_body)) }
        item { NoticeCard(title = stringResource(R.string.ready_detail), icon = Icons.Play) }
        item {
            Text(stringResource(R.string.ready_left), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
}
