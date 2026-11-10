package app.milewage.phone.ui.detail

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import app.milewage.core.shift.RoutePoint
import app.milewage.core.shift.StopRecord
import app.milewage.phone.R
import app.milewage.phone.logic.RouteProjection

/**
 * The shift's simplified route drawn on a Canvas, without map tiles or network: an asphalt ribbon
 * with a lane-yellow centre line (the MileWage mark), the start as a ring, the end as a filled
 * square and the stops as small dots, so the markers differ by shape, not only colour.
 */
@Composable
fun RouteSketch(route: List<RoutePoint>, stops: List<StopRecord>, modifier: Modifier = Modifier) {
    val road = MaterialTheme.colorScheme.secondaryContainer
    val lane = MaterialTheme.colorScheme.primary
    val ink = MaterialTheme.colorScheme.onSurface
    val surface = MaterialTheme.colorScheme.surfaceContainerLow
    val stopColor = MaterialTheme.colorScheme.tertiary
    val label = pluralStringResource(R.plurals.route_label, stops.size, stops.size)
    Column(modifier.clearAndSetSemantics { contentDescription = label }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Canvas(Modifier.fillMaxWidth().height(200.dp)) {
            val pad = 20.dp.toPx()
            val p = RouteProjection.fit(route.map { it.latE7 to it.lonE7 }, size.width, size.height, pad) ?: return@Canvas
            fun at(lat: Long, lon: Long) = p.project(lat, lon).let { Offset(it.first, it.second) }
            val path = Path()
            route.forEachIndexed { i, r ->
                val o = at(r.latE7, r.lonE7)
                if (i == 0) path.moveTo(o.x, o.y) else path.lineTo(o.x, o.y)
            }
            drawPath(path, road, style = Stroke(9.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            drawPath(path, lane, style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            stops.forEach { s ->
                val o = at(s.latE7, s.lonE7)
                drawCircle(surface, 6.dp.toPx(), o)
                drawCircle(stopColor, 4.dp.toPx(), o)
            }
            startMarker(at(route.first().latE7, route.first().lonE7), ink, surface)
            endMarker(at(route.last().latE7, route.last().lonE7), ink, surface)
        }
        Legend(ink, surface, stopColor, stops.isNotEmpty())
    }
}

private fun DrawScope.startMarker(o: Offset, ink: Color, surface: Color) {
    drawCircle(surface, 9.dp.toPx(), o)
    drawCircle(ink, 7.dp.toPx(), o, style = Stroke(3.dp.toPx()))
}

private fun DrawScope.endMarker(o: Offset, ink: Color, surface: Color) {
    val s = 8.dp.toPx()
    drawRect(surface, Offset(o.x - s - 2, o.y - s - 2), androidx.compose.ui.geometry.Size(2 * s + 4, 2 * s + 4))
    drawRect(ink, Offset(o.x - s, o.y - s), androidx.compose.ui.geometry.Size(2 * s, 2 * s))
}

@Composable
private fun Legend(ink: Color, surface: Color, stopColor: Color, withStops: Boolean) {
    val text = MaterialTheme.typography.bodySmall
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Canvas(Modifier.size(18.dp)) { startMarker(center, ink, surface) }
            Text(stringResource(R.string.route_start), style = text, color = muted)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Canvas(Modifier.size(18.dp)) { endMarker(center, ink, surface) }
            Text(stringResource(R.string.route_end), style = text, color = muted)
        }
        if (withStops) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Canvas(Modifier.size(12.dp)) { drawCircle(stopColor, 4.dp.toPx(), center) }
                Text(stringResource(R.string.route_stops), style = text, color = muted)
            }
        }
    }
}
