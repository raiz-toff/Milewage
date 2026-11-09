import type { ExportContext, Exporter } from './registry';

const xml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
const deg = (e7: number) => (e7 / 1e7).toFixed(7);
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

/**
 * GPX 1.1, one track per shift (08 section 11). Points are the stored raw fixes; a shift whose raw points were
 * archived (07 section 4.2) is written from its simplified route and says "[simplified]" in its name and the
 * file's description.
 * Payouts, labels, places and notes are never written.
 */
function* gpx(c: ExportContext) {
  yield '<?xml version="1.0" encoding="UTF-8"?>\n';
  yield '<gpx version="1.1" creator="MileWage" xmlns="http://www.topografix.com/GPX/1/1">\n';
  const simple = c.shifts.some((s) => c.readers.simplified(s.id));
  yield `  <metadata><desc>${
    simple
      ? 'Stored GPS fixes; shifts marked [simplified] keep only the simplified route (5 m tolerance).'
      : 'Stored GPS fixes of the selected shifts.'
  }</desc></metadata>\n`;
  for (const s of c.shifts) {
    const note = c.readers.simplified(s.id) ? ' [simplified]' : '';
    yield `  <trk>\n    <name>${xml(`Shift ${s.localDate} #${s.id}${note}`)}</name>\n    <trkseg>\n`;
    for (const p of c.readers.points(s.id)) {
      const ele = p.altitudeM === null ? '' : `<ele>${p.altitudeM}</ele>`;
      const speed =
        p.speedDmps === null
          ? ''
          : `<extensions><speed>${(p.speedDmps / 10).toFixed(1)}</speed></extensions>`;
      yield `      <trkpt lat="${deg(p.latE7)}" lon="${deg(p.lonE7)}">${ele}<time>${iso(p.t)}</time>${speed}</trkpt>\n`;
    }
    yield '    </trkseg>\n  </trk>\n';
  }
  yield '</gpx>\n';
}

/** RFC 7946: a LineString per shift (totals as properties) and a Point per detected stop (role, confidence). */
function* geojson(c: ExportContext) {
  yield '{"type":"FeatureCollection","features":[';
  let first = true;
  const feature = (f: object) => {
    const text = (first ? '' : ',') + JSON.stringify(f);
    first = false;
    return text;
  };
  for (const s of c.shifts) {
    const coordinates: [number, number][] = [];
    for (const p of c.readers.points(s.id)) coordinates.push([p.lonE7 / 1e7, p.latE7 / 1e7]);
    yield feature({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: {
        kind: 'shift',
        shift_id: s.id,
        local_date: s.localDate,
        started_at: s.startedAt,
        ended_at: s.endedAt,
        duration_s: s.endedAt === null ? null : Math.round((s.endedAt - s.startedAt) / 1000),
        total_m: s.totalM,
        active_m: s.activeM,
        deadhead_m: s.deadheadM,
        personal_m: s.personalM,
        split_estimated: s.segmenter === 'stops',
        simplified: c.readers.simplified(s.id),
      },
    });
    if (!c.driver.stopsOn) continue;
    for (const p of c.readers.stops(s.id)) {
      yield feature({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lonE7 / 1e7, p.latE7 / 1e7] },
        properties: {
          kind: 'stop',
          shift_id: s.id,
          started_at: p.startedAt,
          ended_at: p.endedAt,
          dwell_s: p.dwellS,
          role: p.role,
          est_role: p.estRole,
          confidence: p.confidence,
        },
      });
    }
  }
  yield ']}\n';
}

export const gpxExporter: Exporter = {
  format: 'gpx',
  contentType: 'application/gpx+xml',
  extension: 'gpx',
  requires: ['tracking'],
  run: gpx,
};
export const geojsonExporter: Exporter = {
  format: 'geojson',
  contentType: 'application/geo+json',
  extension: 'geojson',
  requires: ['tracking'],
  run: geojson,
};
