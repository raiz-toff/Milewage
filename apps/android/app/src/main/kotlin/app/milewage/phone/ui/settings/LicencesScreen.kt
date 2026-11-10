package app.milewage.phone.ui.settings

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import app.milewage.phone.R
import app.milewage.phone.ui.components.EmptyState
import app.milewage.phone.ui.components.ListRow
import app.milewage.phone.ui.components.RowDivider
import app.milewage.phone.ui.components.Rows
import app.milewage.phone.ui.components.Screen
import com.mikepenz.aboutlibraries.Libs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** One library in the app, as the licences list shows it. */
data class LibraryRow(val name: String, val version: String?, val licences: List<String>, val website: String?)

/**
 * The open-source libraries in this build and their licences: `res/raw/aboutlibraries.json`, made
 * at build time by the AboutLibraries Gradle plugin from the dependencies (no network), read with
 * aboutlibraries-core. MileWage's own licence (GNU AGPL 3.0) comes first.
 */
object Licences {
    fun read(context: Context): List<LibraryRow>? = runCatching {
        val json = context.resources.openRawResource(R.raw.aboutlibraries).bufferedReader().use { it.readText() }
        Libs.Builder().withJson(json).build().libraries
            .map { lib ->
                LibraryRow(
                    name = lib.name,
                    version = lib.artifactVersion,
                    licences = lib.licenses.map { it.spdxId ?: it.name }.distinct(),
                    website = lib.website ?: lib.scm?.url,
                )
            }
            .sortedBy { it.name.lowercase() }
    }.getOrNull()
}

@Composable
fun LicencesRoute(onBack: () -> Unit) {
    val context = LocalContext.current
    val rows by produceState<List<LibraryRow>?>(initialValue = emptyList(), context) {
        value = withContext(Dispatchers.IO) { Licences.read(context) }
    }
    LicencesContent(rows, onBack) { url ->
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: ActivityNotFoundException) {
            // No browser: the row still names the licence.
        }
    }
}

/** [rows]: empty while reading, null when the list could not be read. */
@Composable
fun LicencesContent(rows: List<LibraryRow>?, onBack: () -> Unit, onOpen: (String) -> Unit) {
    Screen(title = stringResource(R.string.settings_licences), onBack = onBack) {
        item {
            Rows(label = stringResource(R.string.licences_app)) {
                ListRow(
                    headline = stringResource(R.string.app_name),
                    supporting = stringResource(R.string.licences_agpl),
                    onClick = { onOpen(SOURCE_URL) },
                )
            }
        }
        when {
            rows == null -> item { EmptyState(title = stringResource(R.string.licences_failed), body = stringResource(R.string.licences_failed_body)) }
            rows.isEmpty() -> item { CircularProgressIndicator(Modifier.padding(16.dp)) }
            else -> item {
                Rows(label = stringResource(R.string.licences_libraries)) {
                    rows.forEachIndexed { i, r ->
                        if (i > 0) RowDivider()
                        val licence = r.licences.joinToString(", ").ifEmpty { stringResource(R.string.licences_not_stated) }
                        ListRow(
                            headline = r.name,
                            supporting = listOfNotNull(r.version, licence).joinToString(" · "),
                            onClick = r.website?.let { { onOpen(it) } },
                        )
                    }
                }
            }
        }
        item {
            Text(
                stringResource(R.string.licences_note),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            )
        }
    }
}
