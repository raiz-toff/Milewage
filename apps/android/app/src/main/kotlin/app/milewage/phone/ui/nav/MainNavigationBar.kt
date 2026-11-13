package app.milewage.phone.ui.nav

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.milewage.phone.R
import app.milewage.phone.ui.icons.Icons
import app.milewage.phone.ui.theme.surfaces
import kotlin.reflect.KClass

/** A destination in the bottom navigation bar: outlined, filled when selected (Material). */
internal enum class TopLevel(val route: Any, val routeClass: KClass<*>, @StringRes val label: Int, val icon: ImageVector, val selectedIcon: ImageVector) {
    HOME(HomeRoute, HomeRoute::class, R.string.nav_home, Icons.Home, Icons.HomeFilled),
    SHIFTS(ShiftsRoute, ShiftsRoute::class, R.string.nav_shifts, Icons.Shifts, Icons.ShiftsFilled),
    SETTINGS(SettingsRoute, SettingsRoute::class, R.string.nav_settings, Icons.Settings, Icons.SettingsFilled),
}

/**
 * The bottom navigation bar of the main screens: on the page's colour under an outline-variant
 * hairline (no tonal tint), the selected item in the cool-grey pill (secondaryContainer) with its
 * filled icon. The lane mark: a short Lane yellow dash on the hairline above the selected item,
 * as the web's drawer marks the current page. It is decoration; the pill, the filled icon and
 * TalkBack's "selected" carry the state.
 */
@Composable
internal fun MainNavigationBar(selected: TopLevel?, onSelect: (TopLevel) -> Unit) {
    // No lane dash over the selected tab: on the phone it read as a stray mark. The pill and the
    // filled icon say which tab is open, as in Google's own apps.
    Column {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        NavigationBar(containerColor = MaterialTheme.surfaces.page, tonalElevation = 0.dp) {
            TopLevel.entries.forEach { top ->
                val isSelected = top == selected
                NavigationBarItem(
                    selected = isSelected,
                    onClick = { onSelect(top) },
                    icon = { Icon(if (isSelected) top.selectedIcon else top.icon, contentDescription = null) },
                    label = { Text(stringResource(top.label)) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = MaterialTheme.colorScheme.onSecondaryContainer,
                        selectedTextColor = MaterialTheme.colorScheme.onSurface,
                        indicatorColor = MaterialTheme.colorScheme.secondaryContainer,
                        unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                )
            }
        }
    }
}
