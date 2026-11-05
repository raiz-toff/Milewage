import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Mirrors migrations/core (07 section 2.1). Constraints live in the SQL; this file types the queries.
export const users = sqliteTable('users', {
  id: integer('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id),
  country: text('country').notNull(),
  distanceUnit: text('distance_unit', { enum: ['km', 'mi'] }).notNull(),
  currency: text('currency').notNull(),
  timezone: text('timezone').notNull(),
  rawRetentionDays: integer('raw_retention_days').notNull().default(90),
  stopsEnabled: integer('stops_enabled').notNull().default(1),
  diagnosticsLevel: text('diagnostics_level', { enum: ['off', 'basic', 'verbose'] })
    .notNull()
    .default('basic'),
  diagnosticsVerboseUntil: integer('diagnostics_verbose_until'),
  offsiteLastDownloadAt: integer('offsite_last_download_at'),
  offsiteSyncedElsewhereAt: integer('offsite_synced_elsewhere_at'),
  updatedAt: integer('updated_at').notNull(),
});

export const instance = sqliteTable('instance', {
  id: integer('id').primaryKey(),
  instanceId: text('instance_id').notNull(),
  restoreGeneration: integer('restore_generation').notNull().default(0),
  setupConfirmedAt: integer('setup_confirmed_at'),
});

export const vehicles = sqliteTable('vehicles', {
  id: integer('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['car', 'motorcycle', 'van', 'bicycle'] }).notNull(),
  createdAt: integer('created_at').notNull(),
  archivedAt: integer('archived_at'),
});

export const devices = sqliteTable('devices', {
  id: integer('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  platform: text('platform', { enum: ['android', 'ios'] }).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  lastSeenAt: integer('last_seen_at'),
  revokedAt: integer('revoked_at'),
});

export const pairingTokens = sqliteTable('pairing_tokens', {
  id: integer('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
});

export const webSessions = sqliteTable('web_sessions', {
  idHash: text('id_hash').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
});

const userRef = () =>
  integer('user_id')
    .notNull()
    .references(() => users.id);
const vehicleRef = () =>
  integer('vehicle_id')
    .notNull()
    .references(() => vehicles.id);

export const shifts = sqliteTable('shifts', {
  id: integer('id').primaryKey(),
  userId: userRef(),
  clientId: text('client_id').notNull(),
  vehicleId: vehicleRef(),
  status: text('status', { enum: ['active', 'ended', 'finalized'] }).notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  localDate: text('local_date').notNull(),
  totalM: integer('total_m'),
  activeM: integer('active_m'),
  deadheadM: integer('deadhead_m'),
  personalM: integer('personal_m'),
  segmenter: text('segmenter', { enum: ['stops', 'whole_shift'] }).notNull(),
  calcVersion: integer('calc_version'),
  calculatedAt: integer('calculated_at'),
  notes: text('notes'),
  updatedAt: integer('updated_at').notNull(),
  reconStatus: text('recon_status', { enum: ['pending', 'match', 'differs', 'phone_missing'] })
    .notNull()
    .default('pending'),
  reconReasons: text('recon_reasons'),
  phoneTotalM: integer('phone_total_m'),
  phoneCalcVersion: integer('phone_calc_version'),
  inputDigest: text('input_digest'),
  calcMismatch: integer('calc_mismatch').notNull().default(0),
  interruptionsJson: text('interruptions_json'),
  deviceTouchedAt: integer('device_touched_at'),
  overlapsShiftId: integer('overlaps_shift_id'),
});

export const odometerReadings = sqliteTable('odometer_readings', {
  id: integer('id').primaryKey(),
  userId: userRef(),
  vehicleId: vehicleRef(),
  shiftId: integer('shift_id').references(() => shifts.id),
  kind: text('kind', { enum: ['shift_start', 'shift_end', 'year_start', 'year_end'] }).notNull(),
  readingM: integer('reading_m').notNull(),
  recordedAt: integer('recorded_at').notNull(),
});

export const telemetryPoints = sqliteTable('telemetry_points', {
  id: integer('id').primaryKey(),
  userId: userRef(),
  deviceId: integer('device_id')
    .notNull()
    .references(() => devices.id),
  seq: integer('seq').notNull(),
  shiftId: integer('shift_id')
    .notNull()
    .references(() => shifts.id),
  recordedAt: integer('recorded_at').notNull(),
  latE7: integer('lat_e7').notNull(),
  lonE7: integer('lon_e7').notNull(),
  accuracyM: integer('accuracy_m').notNull(),
  speedDmps: integer('speed_dmps'),
  bearingDeg: integer('bearing_deg'),
  altitudeM: integer('altitude_m'),
});

export const trips = sqliteTable('trips', {
  id: integer('id').primaryKey(),
  userId: userRef(),
  shiftId: integer('shift_id')
    .notNull()
    .references(() => shifts.id),
  tripKey: text('trip_key').notNull(),
  clientId: text('client_id'),
  kind: text('kind', { enum: ['active', 'deadhead', 'personal'] }).notNull(),
  originalKind: text('original_kind', { enum: ['active', 'deadhead'] }).notNull(),
  source: text('source', { enum: ['auto', 'manual'] }).notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at').notNull(),
  startLatE7: integer('start_lat_e7'),
  startLonE7: integer('start_lon_e7'),
  endLatE7: integer('end_lat_e7'),
  endLonE7: integer('end_lon_e7'),
  distanceM: integer('distance_m').notNull(),
  purpose: text('purpose').notNull(),
  editedAt: integer('edited_at'),
});

export const tripOverrides = sqliteTable(
  'trip_overrides',
  {
    userId: userRef(),
    shiftId: integer('shift_id')
      .notNull()
      .references(() => shifts.id),
    tripKey: text('trip_key').notNull(),
    kind: text('kind', { enum: ['active', 'deadhead', 'personal'] }).notNull(),
    purpose: text('purpose').notNull(),
    editedAt: integer('edited_at').notNull(),
    deviceId: integer('device_id'),
  },
  (t) => [primaryKey({ columns: [t.shiftId, t.tripKey] })],
);

export const shiftFlags = sqliteTable('shift_flags', {
  id: integer('id').primaryKey(),
  userId: userRef(),
  shiftId: integer('shift_id')
    .notNull()
    .references(() => shifts.id),
  code: text('code').notNull(),
  severity: text('severity', { enum: ['info', 'review'] }).notNull(),
  detail: text('detail'),
  createdAt: integer('created_at').notNull(),
});

export const stops = sqliteTable('stops', {
  id: integer('id').primaryKey(),
  userId: userRef(),
  shiftId: integer('shift_id')
    .notNull()
    .references(() => shifts.id),
  stopKey: text('stop_key').notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at').notNull(),
  dwellS: integer('dwell_s').notNull(),
  latE7: integer('lat_e7').notNull(),
  lonE7: integer('lon_e7').notNull(),
  confidence: text('confidence', { enum: ['low', 'medium', 'high'] }).notNull(),
  estRole: text('est_role', { enum: ['pickup', 'dropoff', 'none'] }).notNull(),
  role: text('role', { enum: ['pickup', 'dropoff', 'other', 'none'] }).notNull(),
});

export const stopLabels = sqliteTable(
  'stop_labels',
  {
    userId: userRef(),
    shiftId: integer('shift_id')
      .notNull()
      .references(() => shifts.id),
    stopKey: text('stop_key').notNull(),
    role: text('role', { enum: ['pickup', 'dropoff', 'other'] }).notNull(),
    platform: text('platform'),
    place: text('place'),
    payoutCents: integer('payout_cents').notNull().default(0),
    tipCents: integer('tip_cents').notNull().default(0),
    notes: text('notes'),
    editedAt: integer('edited_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.shiftId, t.stopKey] })],
);

export const backupRuns = sqliteTable('backup_runs', {
  id: integer('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: integer('created_at').notNull(),
  trigger: text('trigger', {
    enum: ['nightly', 'shift_end', 'manual', 'pre_migration', 'pre_restore'],
  }).notNull(),
  fileName: text('file_name').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  integrityOk: integer('integrity_ok').notNull(),
});
