# 10 — Backup, Restore & Operations Specification

**Lead Agent:** Agent 2 (Self-Hosted Docker & Backend Architect)  
**Auditor:** Agent 5 (Anti-Slop Auditor)  
**Status:** DRAFT SPECIFICATION (Gate 2 input)  
**Parent:** [`plans/milewage/README.md`](./README.md) · Builds on [`03`](./03-self-hosted-docker-architecture-plan.md) §3–§5

**Scope inherited from signed-off Gate 1:** single driver per instance (1.4), the server holds the only copy of the data (1.5), TypeScript + SQLite (1.3), home lab first on x86_64 and ARM64 incl. Raspberry Pi (1.7), Android first (1.6).

**Evidence note:** The web searches behind this document returned mostly secondary sources (blogs, mirrors, guides), not the official sqlite.org or Tailscale reference pages. Claims taken from them are marked *(source)* and must be re-checked against official docs during Spike B before Gate 2 sign-off. Claims from general knowledge are marked *(knowledge)*.

---

## 1. Operating Principles

1. The server is the only copy of a driver's tax records, so **a backup that has never been restored is not a backup**. Every backup is verified when written, and the restore path is tested in Spike B.
2. Everything a driver needs is one command or one button. No cron on the host, no external scheduler.
3. No unauthenticated endpoint reveals driver data, coordinates or system detail.
4. Nothing in this stack requires a paid or third-party cloud service.

---

## 2. Volume Layout

Three named volumes plus Caddy's own. Splitting them lets the data and the backups live on different physical devices (§12).

| Mount in `api` container | Compose volume | Contents | Notes |
|---|---|---|---|
| `/app/data` | `data` | `milewage.db`, `milewage.db-wal`, `milewage.db-shm` | Only the API process touches this. Never copy these three files by hand while the API runs. |
| `/app/data` (same volume) | `data` | `diagnostics.db`, `diagnostics.db-wal`, `diagnostics.db-shm` | Optional and disposable: diagnostics history and capture sessions (`16` §7.1). A second SQLite file with its own connection. **Not backed up and not touched by restore.** Deleting it removes only diagnostics history. Same "never copy by hand while the API runs" rule as above. |
| `/app/backups` | `backups` | `*.db.gz.age` backups, `pre-migration/` subfolder | Can be bind-mounted to a different disk or NAS path. |
| `/app/config` | `config` | `secrets.json` (mode 0600; holds the age public key), `settings.json` (module switches, `08` §16.1) | Generated on first start (§9). Not included in backups; the recovery card carries the age private key. |
| `/srv/tiles` (caddy, read-only) | `tiles` | Optional `region.pmtiles` basemap file (`05` §3.2) | Without it the map draws routes on a plain background. No third-party requests. |
| `/data` (caddy) | `caddy_data` | Certificates and ACME state | Needed only in public-domain mode (§8). |

---

## 3. Backup Method

### 3.1 Decision: SQLite online backup API, driven from the API process

`better-sqlite3` exposes the SQLite online backup API as `db.backup()` *(source: better-sqlite3 `docs/api.md`, retrieved 2026-11-03: returns a promise, copies 100 pages per event-loop cycle by default, and the `progress` callback can pause or abort it)*. The source database stays open and serving requests; it is read-locked only while pages are being read, and a `SQLITE_BUSY` or `SQLITE_LOCKED` return from a step is retryable *(source: SQLite `sqlite3_backup_init` manual page mirror)*.

**Single-connection rule (S0 finding).** `db.backup()` is starvation-free only when every write goes through the one connection that runs the backup. The better-sqlite3 docs state that if a *different* connection mutates the database during a backup, the backup is forcefully restarted, so a busy second writer can stop it from ever finishing; they recommend a single mutating connection when online backups are used. MileWage already uses one write connection (§3.4), so this rule is a constraint on the code, not a change of design: no worker thread, CLI command or migration step may open a second writing connection while the server runs. Read-only connections are unaffected. Spike B test B5b checks this.

**Diagnostics file (1.5c).** `diagnostics.db` (`16` §7.1) is a different database file with its own writer. The rule above is per file, so diagnostics writes should not restart a `milewage.db` backup *(unverified; Spike B test B16)*. `diagnostics.db` is excluded from backups and from restore.

**Procedure (nightly at the instance's local 03:30, and on demand):**
1. `db.backup('/app/backups/.tmp/milewage-<UTC timestamp>.db')`, copying in chunks so the writer is never starved for long.
2. Open the temporary copy read-only and run `PRAGMA integrity_check` and `PRAGMA foreign_key_check`. Both must return clean.
3. Compare row counts of `shifts`, `stop_labels` and `telemetry_points` against the live DB at the snapshot moment. A copy with fewer shifts or stop labels than the live DB at the start of the backup fails. Telemetry may differ by points written during the copy and is not compared.
4. gzip, then encrypt with `age` (§4), then atomically `rename` into `/app/backups/`.
5. Record the result (timestamp, size, sha256, integrity status) in the `backup_runs` table (`07` §2.1), which feeds the status endpoint and the web UI warning.

The backup is the whole database file, so it already includes the sync and audit tables added by `14`/`15` (`change_log`, `overwrite_log`, `trip_overrides`, `shift_flags`, `instance`); no step changes. The restored `change_log` may be behind a phone's cursor, which is why a phone can receive `410 cursor_expired` after a restore and falls back to a full window pull (`15` §6.5).

**Modularity (README §1.3):** the backup *engine* (this procedure, the nightly job, pre-migration and pre-restore copies, the recovery key and the CLI restore) is not toggleable, because the server holds the only copy of the data. Everything around it is: the shift-end trigger subscribes to the `shift.ended` event behind `backup.on_shift_end`, the web "Download backup" button and off-site reminder sit behind `backup.download`, and off-site targets register through the BackupTarget registry (`08` §16.2–§16.3). The setup flow and migrations call the engine through one service function; they do not carry their own backup logic.

### 3.2 Rejected alternatives

| Method | Why rejected for v1 |
|---|---|
| Copying `milewage.db` with `cp`/`rsync` while running | Can capture an inconsistent state, especially with the `-wal` file *(source: multiple guides)*. |
| `VACUUM INTO` | Safe to run live and produces a compacted copy, but rewrites every page, so it is slower and more write-heavy than needed for a nightly job *(source)*. Kept as a manual maintenance command (`milewage-cli compact`), not the backup path. |
| Litestream (continuous replication) | Gives point-in-time recovery, but it is a second always-running process, is oriented to S3-compatible targets, and its checkpointing needs a write lock *(source)*. A driver loses at most one day of data with the nightly job, which is acceptable because the phone keeps unacknowledged points until the server confirms (§13). Revisit only if drivers report needing finer recovery. |
| `pg_dump`-style logical dump | Slower, larger, and unnecessary for SQLite. |

### 3.3 SQLite version requirement

The SQLite project documents a WAL-reset bug present from 3.7.0 through 3.51.2, fixed in 3.51.3 and backported in 3.50.7 and 3.44.6 ([wal.html](https://www.sqlite.org/wal.html), [changes.html](https://www.sqlite.org/changes.html), retrieved 2026-11-03). It triggers only in WAL mode when two or more connections, in separate threads or processes, write or checkpoint at the same instant; the project calls it rare. MileWage's single write connection (§3.1, §3.4) avoids the trigger, so the startup check is defence in depth. The build asserts that the bundled SQLite version is at or above the fixed release in its series (3.51.3, 3.50.7 or 3.44.6) and refuses to start otherwise, and records the bundled `better-sqlite3` SQLite version at build time (B12).

### 3.4 Database settings (applied on every connection open)

`journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`, `wal_autocheckpoint=1000`. `synchronous=NORMAL` trades a possible loss of the last few acknowledged transactions on power loss for fewer fsyncs; consistency is preserved *(source)*. Telemetry loss on power cut is tolerable (the phone resends anything not acknowledged); shift and delivery finalisation use `PRAGMA wal_checkpoint(PASSIVE)` after commit so closed shifts are on disk promptly.

---

## 4. Encryption of Backups at Rest

**Decision: encrypt every backup file with `age`, to a recipient key generated at first setup.**

- `age` is a small, audited file-encryption format; the Go (`age`) and Rust (`rage`) tools read and write the same format, and age accepts SSH keys as recipients *(source)*. In Node the API uses FiloSottile's TypeScript implementation, the npm package `age-encryption` (repository `typage`; [npm](https://npmjs.com/package/age-encryption), [GitHub](https://github.com/FiloSottile/typage), retrieved 2026-11-03). **Pin an exact version in the lockfile:** the package is pre-1.0 (0.x) and its dependencies have changed between releases. It is ESM-only, so the server toolchain must be ESM (`03` §2). Files written by the pinned version must decrypt with the standard Go `age` tool; this is checked by Spike B test B14 (`12`).
- At first run the server generates an age keypair. The **public key** is stored in `config/secrets.json`. The **private key is shown once** on the setup screen as a recovery card (printable, text) and is never stored on the server. Setup does not complete until the driver types back the last 6 characters of the key.
- Why encrypt locally as well as off-site: backups travel (Syncthing, rsync, USB drives, a friend's NAS). Location history reveals where the driver lives and sleeps. The live database sits on the home server; a backup file must not be readable by whoever holds the copy.
- **Lost key consequence, stated plainly in the UI:** backups cannot be opened without the recovery card. The live database does not depend on the key.
- Rejected: a passphrase-based scheme (drivers pick weak passphrases and the server would need to hold it to run unattended); restic/borg repositories (a second backup system with its own keys and a larger footprint for no gain at this size); rclone crypt (no published threat model *(source)* and an extra moving part).

---

## 5. Retention

| Tier | Kept | Notes |
|---|---|---|
| Daily | 7 | Oldest beyond 7 days removed after a successful new backup. |
| Weekly (Sunday's) | 4 | |
| Monthly (1st's) | 12 | Matches the common record-keeping period for tax logs. |
| Pre-migration | last 3 | In `pre-migration/`, never pruned by the tiers above. |
| Pre-restore | last 2 | The database replaced during a restore (§6). |

Pruning runs only after a new backup verified clean. If the backup job fails, **nothing is deleted**. Estimated size: tens of MB per backup in year one after downsampling (§13 of `03`); the disk check in §11 enforces room for them.

---

## 6. Off-Site Copies

| Target | v1 | Decision |
|---|---|---|
| **Web UI "Download latest backup"** (encrypted file) | Yes | The simplest off-site step for a non-technical driver. |
| **Syncthing / rsync / rclone / NAS job pointed at the `backups` volume** | Documented, not built | Files are already encrypted and atomically renamed, so any file-sync tool is safe to use. Zero code in MileWage. |
| **Built-in S3-compatible upload** | v1.1 | Would pull in an SDK dependency; deferred until Spike B shows the RAM headroom. |
| **Built-in WebDAV upload** | Not planned | Syncthing/rclone cover it. |

**Off-site warning (anti-silent-loss):** the web UI shows a persistent banner until the driver has either downloaded a backup in the last 30 days or tapped "My folder is synced elsewhere" (a setting that re-asks every 90 days). MileWage cannot see inside Syncthing, so this is an honest reminder, not a check.

---

## 7. Restore Procedure

Run on the host: `docker compose exec api milewage-cli restore --file=/app/backups/<file>.db.gz.age`. The private key is read from a prompt on stdin or `--key-file`, and is never written to disk.

**Status (PR R1, 2026-11-08):** built as `milewage-cli restore --file <path> [--key <key> | --key @<file>] [--yes]`, run **with the API stopped** in a one-off container: `docker compose stop api`, then `docker compose run --rm --no-deps api milewage-cli restore --file /app/backups/<file>.db.gz.age` (it asks for the key and for confirmation), then `docker compose up -d`. Differences from the steps below, on purpose: no quiesce channel is needed because the API is stopped, and the CLI refuses while any process holds the database (an exclusive SQLite lock attempt fails; the message says to stop the api service first). Step 3's safety copy is the current data itself, **moved** (never deleted) into `/app/data/before-restore-<time>/` on the same volume (a folder next to the volume, as `<data>.before-restore`, would land in the throwaway container). Steps 1, 4 and 6 use the same code as `POST /setup/restore` (`prepareRestore`, `swapRestored` in `backup/restore.ts`): the generation becomes max(moved-aside generation, restored generation) + 1. Step 5's revert puts the moved data back. `docker compose exec` cannot be used: the API must not be running.

1. **Preflight:** decrypt to a temp file in `/app/data/.restore-tmp/`, gunzip, run `PRAGMA integrity_check` and `PRAGMA foreign_key_check`. Read `schema_version`. **Abort without touching live data** if any check fails or if the backup's schema version is newer than the running app's.
2. **Quiesce:** CLI tells the API to stop accepting writes (returns 503, the phone keeps buffering) and waits for in-flight transactions.
3. **Safety copy:** back up the current DB via §3.1 into `pre-restore/` (kept per §5).
4. **Swap:** close all connections, move the live `milewage.db`, `-wal`, `-shm` out of the way, move the verified file into place, run forward migrations if the backup is an older schema (with a pre-migration backup per §10). Then set `instance.restore_generation = max(live generation before the swap, restored generation) + 1` and keep the restored `instance_id` (`07` §2.7, `15` §9.3). The generation is taken from the **pre-swap live** value, not from the backup, because the backup is older and its counter is lower.
5. **Reopen** and run the verification below. If it fails, automatically put the pre-restore database back and report the failure.
6. **Verification output (printed and logged):** integrity check result, schema version, counts of shifts, stop labels and telemetry points, date range of data, total miles for the most recent shift, the instance id and the new restore generation. The driver compares these to what they expect.
7. **Resume:** API accepts writes again. Every response now carries the higher `X-MileWage-Restore-Gen`, so each phone puts what it still holds (points of the last `LOCAL_RAW_DAYS`, default 14; all shifts, trips, deliveries and odometer readings) back into its upload queue and re-sends it; idempotent point and `client_id` identities make the overlap safe (`08` §5, `15` §9.3). Anything older than the phone's retention window cannot be re-sent, and the verification output tells the driver the date range that was restored.

**Fresh-host recovery (dead SD card or VPS):** install Docker, `docker compose up -d`, skip account creation on the setup screen via "Restore from backup" (`POST /setup/restore`, `08` §2.3, allowed only while no user exists), upload the file, enter the recovery key. Device credentials are stored in the database, so paired phones keep working if the server URL is unchanged; otherwise re-pair by QR (§9).

**Test:** the restore is exercised in CI every build (create DB, write fixture data, backup, wipe, restore, compare counts) and manually on a Pi in Spike B.

---

## 8. Network Access & HTTPS (Home Lab First)

### 8.1 Decision

Compose keeps both containers as the owner decided. In **home-lab mode** (default):

- Caddy listens on plain HTTP `:8080`, **published only on `127.0.0.1:8080`** of the host. `tailscale serve` connects through the Docker gateway of the stack's network, not from loopback (checked 2026-11-07, plan 19 P5), so Caddy sets `trusted_proxies static <gateway>/32` (`MILEWAGE_PROXY_GATEWAY`, default `172.29.88.1`) and keeps the forwarded `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-Forwarded-For`; the API trusts `X-Forwarded-For` only from the proxy subnet. Account and device rate limits do not depend on client IP (`08` §7.4). It serves the static web client, compresses, adds security headers and proxies `/api` and the WebSocket to the API container. The API container publishes no ports.
- **Tailscale runs on the host** and terminates HTTPS: `tailscale serve --bg 8080` gives the tailnet name `https://<host>.<tailnet>.ts.net` with a managed certificate, proxying to the loopback port *(source: Tailscale Docker guide and third-party guides)*. This requires **HTTPS certificates to be enabled in the tailnet's DNS settings** and the first request can be slow while the certificate is issued *(source)*.
- **Privacy warning (S0):** per Tailscale's HTTPS documentation, "Enabling the feature publishes your machine names and tailnet DNS name on a public ledger" (certificate transparency). **Before enabling HTTPS, give the server a non-sensitive machine name** (not a name, address or employer) and use a tailnet name the owner is willing to have public. The install steps say this before the "enable HTTPS" step.
- The HTTPS address is the full MagicDNS name (`https://<host>.<tailnet>.ts.net`); a bare short name does not get a certificate. MagicDNS must be on (default for tailnets created after 2022-10-20).
- No router ports are opened. The phone needs the Tailscale Android app signed in to the same tailnet.

In **public mode** (`MILEWAGE_MODE=public`, v1.1 target, VPS): Caddy listens on 80/443 with `DOMAIN` set and obtains Let's Encrypt certificates automatically. Same containers, a different Caddyfile. `MILEWAGE_MODE` only selects the Caddyfile; it is deployment configuration, not a module.

### 8.2 Why this fits, and what the alternatives cost

| Option | Verdict |
|---|---|
| Host Tailscale + `tailscale serve` → loopback Caddy (chosen) | One mechanism, no extra container, no auth key in compose. |
| Tailscale as a sidecar container (`network_mode: service:tailscale`) | Works and is documented by third parties *(source)*, but adds an auth key to manage and takes down connectivity of everything sharing its network namespace if login fails *(source)*. **Documented as the alternative for NAS devices where Tailscale cannot be installed on the host**, not the default. |
| Caddy with a public domain on a home connection | Needs port forwarding and a domain; unsupported on home lab (Gate 1 item 1.7). |
| `tls internal` (self-signed) | Phone would have to trust a custom CA. Unsupported. |
| Cloudflare Tunnel | Acceptable: point it at `127.0.0.1:8080`. Documented, not packaged. |

**Why keep Caddy at home:** single entry point for static files, gzip, headers and WebSocket proxying, and the same file becomes the public-mode TLS terminator later. Its budget is small (§14).

---

## 9. Secrets & Credentials

| Secret | Decision |
|---|---|
| **Session secret** | **None needed.** Web sessions are opaque random IDs stored hashed server-side (`07` `web_sessions`), so there is no signing key and no `JWT_SECRET`. A driver never has to invent a secret. `config/secrets.json` holds only the age public key. |
| **Web login** | One owner account created on first run. Password hashed with `scrypt` from `node:crypto` (no native module, builds identically on ARM64). Session = opaque random ID in an `HttpOnly; Secure; SameSite=Strict` cookie, stored hashed in `web_sessions` (`07` §2.1). |
| **Device credentials (phone)** | 256-bit random opaque token issued at QR pairing; the server stores only its SHA-256 hash, so a leaked database does not leak working credentials. Not a JWT, so revocation is instant. |
| **QR pairing token** | One-time, expires in 10 minutes, bound to a single device on first use. |
| **Backup age key** | Private key never on the server (§4). |
| **Rotation** | `milewage-cli rotate-secrets`: deletes every `web_sessions` row (logs out all web sessions). A device is rotated by revoking it in the web UI and re-pairing. Backups are not re-encrypted on rotation; a lost or suspected-leaked age key is handled by generating a new key (old backups stay readable only with the old card). |
| **Brute force** | Login and pairing endpoints rate-limited (5 failures per 15 minutes per IP and per account). |

---

## 10. Schema Migration & Upgrade

1. Images are tagged with explicit versions. The compose file pins a version tag, never `:latest` (`03` §3 now does this).
2. On start the API compares `schema_version` with its bundled Drizzle migrations. If a migration is pending it first runs the backup in §3.1 into `pre-migration/`, **verified**, then applies migrations inside a single transaction and records the new version. If the backup fails, **the migration does not run** and the API stays on the old schema in read-only mode with a clear status message.
3. The API **refuses to start against a newer schema than it knows** (prevents an old image corrupting a new database after a mistaken downgrade).
4. Upgrade: `docker compose pull && docker compose up -d`. The status page shows the migration result.
5. **Rollback:** set the previous image tag, then `milewage-cli restore` the latest `pre-migration/` backup. Migrations are forward-only; rollback always goes through a restore, never a down-migration. Any data written after the upgrade is lost, so the UI states this before the driver confirms.

---

## 11. Health, Status, Logging, Disk

### 11.1 Endpoints

- `GET /healthz` — unauthenticated, returns `{"ok":true}` or 503 and nothing else. Used by the Docker `HEALTHCHECK` (interval 30s) and by Caddy. It checks that the DB answers a trivial read.
- `GET /api/v1/system/status` — authenticated. Returns app and schema version, DB size, WAL size, free disk, last backup time and status, last off-site acknowledgement, count of paired devices, and SQLite version.

### 11.2 Logging

Structured JSON lines to stdout. Docker log driver `json-file` with `max-size: 10m`, `max-file: 3`. **Never log coordinates, tokens, passwords or request bodies.** Telemetry requests log only batch size and result. Levels: `info` default, `debug` opt-in and still redacted. Operational numbers (RSS, event-loop lag, error rates, backup and migration results) are recorded as events in `diagnostics.db` (`16` §3.2), not in logs; the same no-coordinates, no-tokens rule applies to both.

### 11.3 Disk-space behaviour

| Free space on the data volume | Behaviour |
|---|---|
| Above 1 GB and 10% | Normal. |
| Below 1 GB or 10% | Warning banner in web UI; status endpoint flags it. |
| Below 2× the DB size | Nightly backup is **skipped with an error banner** (a failed backup never deletes older ones). |
| Below 200 MB | **Every mutating route** returns **HTTP 507** (enforced once in core, so it works with any module on or off), except login/logout, exports and backup download. The phone treats 507 as retryable and keeps buffering. Reads, login, export and backup download keep working so the driver can still pull their records. |

SQLite WAL growth is bounded by checkpointing (§3.4); the backup temp files are deleted on failure and on startup.

**Diagnostics (`16` §7.2).** Below the 1 GB / 10% line, `verbose` diagnostics events are accepted and discarded, new capture sessions are refused and capture data older than 7 days is pruned. Below 200 MB, the diagnostics ingest route returns `507` like every other mutating route and the server pauses its own diagnostics writes. Diagnostics are capped (100 MB events, 200 MB capture) so they cannot be the cause of a low-disk state.

---

## 12. Raspberry Pi & SD-Card Wear

No source found quantified SD-card wear from this workload, so the guidance below is conservative engineering practice, not measured fact *(knowledge)*; Spike B measures real write volume.

- **Recommendation shown in the install docs:** put the `data` volume on a USB SSD, and the `backups` volume on a **different device** from `data` (a backup on the same card dies with it).
- **If the data stays on the SD card:** WAL with `synchronous=NORMAL`, one transaction per telemetry batch (up to 200 points, never per point), Docker log rotation (§11.2), no debug logging in production, and the downsampling job running once a night rather than continuously.
- Expected write volume for one driver at about one point every 3 seconds during a shift is on the order of 1,200 rows per hour of driving *(derived from the sampling table in `02`)*, tiny relative to card endurance; the dominant writer risk is WAL checkpoints and logs, which the settings above bound.
- Spike B includes a **power-pull test** on a Pi: pull power during a telemetry stream, reboot, confirm `integrity_check` passes and the phone's resend produces no duplicates.

---

## 13. Interaction With the Phone (Data-Loss Boundary)

The recovery window equals one backup interval, and the phone narrows it: it keeps every point until the server's batch response confirms it, then keeps acknowledged points for 14 days more (`15` §3.2), and it re-sends them after a restore (`restore_generation`, §7 step 7). After a restore from last night's backup, the phone may still hold points from today only if it had not yet received the acknowledgement, so any acknowledged-but-restored-away data is the only exposure. To limit it, **shift end triggers an immediate verified backup** (rate-limited to once per 15 minutes; the `shift.ended` subscription behind `backup.on_shift_end`). A per-delivery backup was cut: a delivery is one small row, and a backup per delivery adds disk writes for almost no recovery gain. The `507` and `503` responses in §7 and §11.3 are specified as retryable for the phone's upload queue.

---

## 14. Resource Budgets (Idle and Peak)

| Component | Idle RSS target | Peak RSS limit | Notes |
|---|---|---|---|
| `api` (Node 22 + Fastify + better-sqlite3) | 80 MB | 120 MB | Run with `--max-old-space-size=96`. |
| `caddy` (Alpine) | 15 MB | 30 MB | |
| **Stack total (compose)** | **≤ 100 MB** | **≤ 150 MB** | Matches `03` §1. |
| Host `tailscaled` | not counted | — | Typically tens of MB on the host *(knowledge)*; measured and reported separately in Spike B so the true Pi total is known. |

CPU: under 0.5% averaged over 10 idle minutes (excluding the nightly backup and downsample jobs).

The `diagnostics` module (`16`) lives inside the `api` budget: target **at most 5 MB** extra RSS at idle *(estimate; Spike B test B17 measures the stack with the module on and off)*.

---

## 15. Spike B Test Plan (Docker Memory & SQLite Write Throughput)

**Hardware matrix:** (1) Raspberry Pi 4 or 5, 2 GB, on SD card; (2) the same Pi with data on a USB SSD; (3) 1 GB x86_64 VPS. All with the Compose stack as shipped.

| # | Test | Method | Pass criterion |
|---|---|---|---|
| B1 | Idle footprint | Run 30 min with no traffic; `docker stats` | Stack ≤ 100 MB RSS, CPU < 0.5%. |
| B2 | Realistic load | 1 simulated driver, 1 point / 3 s, batched every 60 s, for 8 h compressed (time-scaled) | No errors, RSS stable (no growth > 10% over the run). |
| B3 | Stress ingestion | 50 req/s, 200-point gzip batches, 10 min | Write p99 < 100 ms per batch; zero client-visible `SQLITE_BUSY`; RSS peak ≤ 150 MB. |
| B4 | Reader during writes | B3 plus a dashboard route-history query every second | Read p95 < 200 ms. |
| B5 | Backup under load | Trigger §3.1 during B3 | Backup completes, copy passes `integrity_check`, no write stalls > 1 s. |
| B5b | Second writer during backup (S0) | Repeat B5 once with a deliberately opened second *writing* connection, then once with only the single write connection | With one writer: completes. With a second writer: expected to restart or stall; the result is recorded and confirms the §3.1 rule. |
| B6 | Crash safety | `kill -9` the API mid-batch, restart | `integrity_check` clean; the resent batch inserts no duplicates. |
| B7 | Power pull (Pi) | Cut power during B2, reboot | `integrity_check` clean; at most the last few seconds of acknowledged telemetry lost. |
| B8 | Restore drill | Fresh host: `docker compose up`, run §7 | Counts match the verification output; total time recorded. |
| B9 | Migration drill | Apply a test migration on a 1 GB DB | Pre-migration backup verified first; migration time recorded; forced failure leaves the old schema intact. |
| B10 | Low disk | Fill the volume to the §11.3 thresholds | Banner, backup skip, then 507 on writes with reads still working. |
| B11 | Write volume | Measure bytes written per driving hour on the Pi (`/proc/<pid>/io`, `iostat`) | Reported; used to confirm the SD-card guidance in §12. |
| B12 | SQLite version | Print `sqlite_version()` in CI | At or above the fixed release in its series (§3.3). |
| B16 | Diagnostics under load (`16` §9.2) | B3 plus 50 events per second to `POST /diagnostics/events`, with a `milewage.db` backup (§3.1) during it | Diagnostics ingest p99 < 100 ms; the backup completes and passes `integrity_check`; `lag_max_ms` with the module on is at most 100 ms worse than with it off; zero client-visible `SQLITE_BUSY` on `milewage.db`. |
| B17 | Diagnostics idle cost (`16` §9.2) | B1 with `modules.diagnostics` on versus off | RSS difference ≤ 5 MB; CPU difference < 0.1% **(new)**. |

Measure with `docker stats`, `/proc/<pid>/io`, and a small load script in the spike repo. **The spike script is code and is out of scope until Gate 4 approval; this table is its specification.**

---

## 16. Decisions Table

| # | Decision | Reason |
|---|---|---|
| 1 | Backups via the SQLite online backup API (`better-sqlite3 db.backup()`), verified on write | Consistent copy while live; built into the chosen library. |
| 2 | Backups gzip + `age` encrypted, key shown once to the driver, never stored on the server | Backups travel; location history is sensitive. |
| 3 | Retention 7 daily / 4 weekly / 12 monthly, plus last 3 pre-migration and 2 pre-restore | Matches Gate 1 `03` §5; protects against bad upgrades and bad restores. |
| 4 | v1 off-site = download button + documented Syncthing/rsync; S3 upload is v1.1 | Zero extra dependencies, still gets copies off the box. |
| 5 | Restore aborts before touching live data on any failed check, and auto-reverts on a failed post-swap check | A restore must not be able to destroy a working database. |
| 6 | Home lab: Caddy on loopback `:8080`, host Tailscale terminates HTTPS | No extra container, no router changes, fits the signed-off deployment target. |
| 7 | No signing secret: opaque hashed web sessions and device tokens; `scrypt` for the password; age public key generated on first start | No driver-invented secrets; no native modules on ARM64. |
| 8 | Migrations are forward-only, preceded by a verified backup; rollback = restore | Simple and safe; no untested down-migrations. |
| 9 | Low disk: back off writes with 507 and keep reads/exports alive | The phone keeps the data; the driver can still get their records out. |
| 10 | Stack budget ≤ 100 MB idle, ≤ 150 MB peak, measured in Spike B | Consistent with `03` §1. |
| 11 | Diagnostics live in a separate, non-backed-up `diagnostics.db`; diagnostics ingest follows the low-disk rules | Tax backups stay small and free of capture coordinates; diagnostics can never contend with the single write connection or stop the server from starting (`16` D3, D15). |

## 17. Rejected Alternatives (Summary)

Litestream for v1; `VACUUM INTO` as the backup path; raw file copy; passphrase-based backup encryption; restic/borg; rclone crypt; Tailscale sidecar as default; Caddy-with-public-domain on home lab; `tls internal`; JWT access tokens for devices; down-migrations; storing the age private key on the server; built-in WebDAV upload.

## 18. Anti-Slop Audit (Agent 5)

1. **Is each feature solving a real driver problem?** Backup, restore, low-disk behaviour and the off-site banner each prevent loss of tax records. Passes.
2. **Is anything speculative?** S3 upload is already deferred to v1.1. Litestream, WebDAV and public-domain mode are explicitly out of v1.
3. **Unverified claims:** the sources for SQLite behaviour, the Tailscale pattern and the WAL-reset bug are secondary; B12 and Gate 2 must re-check them on official pages. The `age-encryption` npm package name and the SD-card wear reasoning are from general knowledge and flagged as such.
4. **Conflicts with `03`: RESOLVED in the Gate 2 audit (`11`).** `03` now has no `JWT_SECRET`, pins the image tag, publishes only `127.0.0.1:8080`, and names backups `*.db.gz.age`.
5. **Is a non-technical driver able to do this?** The hardest steps are installing Tailscale on the host and enabling HTTPS certificates in the tailnet DNS settings. Install docs must show these with screenshots; this is the main usability risk.
6. **Battery/RAM claims:** budgets in §14 are targets, not measurements, until Spike B runs.
7. **Diagnostics (1.5c).** A second SQLite file is the main risk to the single-writer reasoning of §3.1; it is a different file with its own connection, and Spike B16 must show that a `milewage.db` backup is unaffected. Capped sizes (100 MB and 200 MB) keep diagnostics from causing the low-disk state they must report.

---

## 19. Sources

- [SQLite backup and restore overview (coddy.tech)](https://coddy.tech/docs/sqlite/backup-and-restore)
- [`sqlite3_backup_init` manual page mirror (NetBSD)](https://m.mirror.yandex.ru/NetBSD/NetBSD-current/src/external/public-domain/sqlite/man/sqlite3_backup_init.3)
- [Backup notes for a project using SQLite (adyxax.org)](https://git.adyxax.org/adyxax/tfstated/wiki/Backup)
- [How to Back Up a WAL-Mode SQLite Database Without Losing Data (OneUptime)](https://oneuptime.com/blog/post/2026-09-08-back-up-wal-mode-sqlite-safely/markdown)
- [SQLite Production API Concurrency: WAL Mode Limits (Kunal Ganglani)](https://www.kunalganglani.com/blog/sqlite-production-api-wal.md)
- [Host a private web server with Docker (Tailscale docs)](https://tailscale.com/docs/solutions/host-private-server-docker)
- [Four ways to run Tailscale with services (Tailscale blog)](https://tailscale.com/blog/four-ways-tailscale-service)
- [Docker Compose + Tailscale (Phase docs)](https://docs.phase.dev/self-hosting/tailscale)
- [ScaleTail concepts](https://www.mintlify.com/tailscale-dev/ScaleTail/concepts)
- [How to Encrypt Files and Directories with age on Ubuntu (OneUptime)](https://oneuptime.com/blog/post/2026-03-02-encrypt-files-directories-age-ubuntu/markdown)
- [Encrypt and decrypt files with Age or Rage (ADMIN Magazine)](https://admin-magazine.com/Articles/Encrypt-and-decrypt-files-with-Age-or-Rage)
- [Comparison with rclone, gocryptfs+rsync, borg (restic forum)](https://forum.restic.net/t/comparison-with-rclone-gocryptfs-rsync-borg/8506)
