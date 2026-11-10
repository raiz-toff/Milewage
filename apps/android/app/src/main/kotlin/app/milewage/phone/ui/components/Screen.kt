package app.milewage.phone.ui.components

import app.milewage.phone.ui.icons.Icons
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.milewage.phone.R
import app.milewage.phone.ui.theme.Surfaces
import app.milewage.phone.ui.theme.surfaces

/** The padding around a screen's content and between its cards (design system: 16). */
val ScreenPadding = 16.dp

/**
 * Every screen's frame: a Material 3 top app bar with the title (a [subtitle] under it, and a back
 * arrow when [onBack] is given), then the content as a lazy column, 16 dp from the edges and 16 dp
 * between items. Everything sits on the page ([Surfaces.page]); the top bar keeps the page's colour
 * and draws an outline-variant hairline once the content scrolls under it.
 *
 * - [bottomBar]: the screen's one main action, held at the bottom (Start shift, End shift).
 * - [onRefresh]: pull to refresh ([refreshing] while it runs).
 * - [onTitleLongClick]: a long press on the title (Home: the diagnostics screen), with [titleLongClickLabel] for TalkBack.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun Screen(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
    bottomBar: @Composable () -> Unit = {},
    onRefresh: (() -> Unit)? = null,
    refreshing: Boolean = false,
    onTitleLongClick: (() -> Unit)? = null,
    titleLongClickLabel: String? = null,
    content: LazyListScope.() -> Unit,
) {
    val scroll = TopAppBarDefaults.pinnedScrollBehavior()
    Scaffold(
        modifier = modifier.nestedScroll(scroll.nestedScrollConnection),
        containerColor = MaterialTheme.surfaces.page,
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        val long = if (onTitleLongClick != null) {
                            Modifier.combinedClickable(onLongClickLabel = titleLongClickLabel, onLongClick = onTitleLongClick, onClick = {})
                        } else {
                            Modifier
                        }
                        Column(long.semantics { heading() }) {
                            Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (subtitle != null) {
                                Text(
                                    subtitle,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    },
                    navigationIcon = {
                        if (onBack != null) {
                            IconButton(onClick = onBack) {
                                Icon(Icons.Back, contentDescription = stringResource(R.string.back))
                            }
                        }
                    },
                    actions = actions,
                    // The page's colour in both states: no tonal tint when content scrolls under it,
                    // only a hairline (below), as on the web's top bar.
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.surfaces.page,
                        scrolledContainerColor = MaterialTheme.surfaces.page,
                    ),
                    scrollBehavior = scroll,
                )
                val scrolled = scroll.state.overlappedFraction > 0.01f
                HorizontalDivider(color = if (scrolled) MaterialTheme.colorScheme.outlineVariant else Color.Transparent)
            }
        },
        bottomBar = bottomBar,
    ) { inner ->
        val direction = LocalLayoutDirection.current
        // The list starts under the top bar (so the pull-to-refresh indicator shows below it) and
        // scrolls behind the bottom bar's padding.
        val below = Modifier.fillMaxSize().padding(top = inner.calculateTopPadding())
        val list = @Composable {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(
                    start = inner.calculateStartPadding(direction) + ScreenPadding,
                    end = inner.calculateEndPadding(direction) + ScreenPadding,
                    top = ScreenPadding,
                    bottom = inner.calculateBottomPadding() + ScreenPadding,
                ),
                verticalArrangement = Arrangement.spacedBy(ScreenPadding),
                content = content,
            )
        }
        if (onRefresh != null) {
            PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = below) { list() }
        } else {
            androidx.compose.foundation.layout.Box(below) { list() }
        }
    }
}

/**
 * The screen's one main action at the bottom: a full-width button at least 64 dp tall (easy to hit
 * in a vehicle mount), above the navigation bar.
 */
@Composable
fun BottomAction(content: @Composable () -> Unit) {
    androidx.compose.material3.Surface(color = MaterialTheme.surfaces.page, tonalElevation = 0.dp) {
        Column(Modifier.padding(horizontal = ScreenPadding, vertical = 12.dp)) { content() }
    }
}
