import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
