// Bulk-inserts fake telemetry straight into milewage.db to build a large database quickly (B9: about
// 14 million rows is roughly 1 GB; B10: 2 million is roughly 150 MB). Run with the API STOPPED, inside
// the api image, with the volume mounted:
//   docker compose run --rm --no-deps -e NODE_PATH=/app/node_modules -v $PWD/infra/vm-tests/tools:/tools:ro \
//     --entrypoint node api /tools/seed.cjs --data-dir /app/data --rows 14000000 --device 1 --shift 1
const Database = require('better-sqlite3');
const path = require('node:path');

const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].slice(2)] = process.argv[i + 1];
const rows = Number(a.rows);
const device = Number(a.device ?? 1);
const shift = Number(a.shift ?? 1);
const chunk = 1_000_000;
const db = new Database(path.join(a['data-dir'], 'milewage.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = OFF');
const user = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').pluck().get();
if (user === undefined)
  throw new Error('set the instance up first: there is no owner in this database');
const base = Date.now() - 400 * 86_400_000;
// Seeded rows use very high seq numbers so they never collide with a phone's own counter.
let seq = Math.max(
  1_000_000_000,
  db
    .prepare('SELECT coalesce(max(seq), 0) FROM telemetry_points WHERE device_id = ?')
    .pluck()
    .get(device),
);
const insert =
  db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < @n)
  INSERT INTO telemetry_points (user_id, device_id, seq, shift_id, recorded_at, lat_e7, lon_e7, accuracy_m, speed_dmps, bearing_deg, altitude_m)
  SELECT @user, @device, @s + i, @shift, @b + (@o + i) * 2000, 377749290 + ((@s + i) % 5000) * 37, -1224194160 + ((@s + i) % 7000) * 23,
         5 + (@s + i) % 9, 80 + (@s + i) % 40, (@s + i) % 360, 15 FROM n`);
const t0 = Date.now();
for (let done = 0; done < rows; done += chunk) {
  const n = Math.min(chunk, rows - done);
  db.transaction(() => insert.run({ n, s: seq, o: done, b: base, user, device, shift }))();
  seq += n;
  process.stdout.write(`\r${done + n}/${rows}`);
}
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log(`\ndone in ${Math.round((Date.now() - t0) / 1000)} s`);
