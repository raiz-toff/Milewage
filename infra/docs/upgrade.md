# Upgrade and rollback

Specs: plan 10 (in the git history) sections 10 and 3.1. The drill that proves the failure path is test **b09** of `infra/vm-tests` (see its README); it has been run on a development machine with a forced failure and a 300,000-row database, not yet on the target VM.

## Upgrade

1. Take a backup you can find: Backups page, "Back up now", then download the file to another machine.
2. Get the new version of the repository (`git pull`) and run:

   ```bash
   docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d --build
   ```

   The compose file pins an explicit image tag, never `:latest`. The tag follows `VERSION`; bump it with `npm run version:sync` when you release your own build.

3. On start the API compares its migrations with the database. If any is pending it first writes a verified **pre-migration backup** into the `backups` volume (`pre-migration/`, the last 3 are kept), then applies the migrations in one transaction. The Backups page and `GET /system/status` show the result.
4. Before an upgrade you can see what a newer calculation would change for old shifts without changing anything:

   ```bash
   docker compose -f infra/docker/docker-compose.yml exec api milewage-cli recalc --dry-run --since 2026-01-01
   ```

   A finalized shift is never recalculated automatically; the report only prints stored against recomputed totals.

## If the upgrade fails

- **The pre-migration backup fails:** the migration does not run. The API stays on the old schema in read-only mode with a status message (writes answer 503 `read_only_mode`, the phone keeps its data and retries). Fix the cause (usually disk space: free at least twice the database size), then restart the API.
- **A migration fails:** it runs in one transaction, so the old schema and rows are intact; the API stays up read-only.
- **A newer database than the code knows** (an old image started by mistake): the API refuses to start. Start the newer image again.

## Roll back to the previous version

Migrations only go forward, so a rollback means going back to the data as it was before the upgrade: the latest file in `pre-migration/`. Anything written after the upgrade is lost (phones re-send what they still hold, see below). Run these from the repository root, after:

```bash
alias dc='docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env'
```

1. Put the previous version back and build it, **without starting it** (it refuses the upgraded database anyway):

   ```bash
   git checkout <previous version>
   dc build api
   ```

2. Stop the API, see which pre-migration backups exist, and restore the newest one:

   ```bash
   dc stop api
   dc run --rm --no-deps api ls /app/backups/pre-migration
   dc run --rm --no-deps api milewage-cli restore --file /app/backups/pre-migration/<name>.db.gz.age
   ```

   It asks for the recovery key (the `AGE-SECRET-KEY-1...` line on your recovery card), checks the file, says what it will do and asks you to type `yes`. To skip the questions: `--key AGE-SECRET-KEY-1...` (start the command with a space so the shell does not keep it in its history) and `--yes`. `--key @/path/to/file` reads the key from a file inside the container.

3. Start everything again: `dc up -d`.

What the command does: it refuses while the API holds the database ("stop the api service first"); it decrypts and checks the backup with the same code as the restore screen and stops with nothing changed on a wrong key, a damaged file or a backup from a newer MileWage; it **moves** the current database and receipt files into `/app/data/before-restore-<time>/` (same `data` volume, nothing deleted) and writes the backup's data and receipts in their place; if the result fails its checks it puts the old data back. It raises the restore generation past both the old and the restored value, so each paired phone re-sends what it still holds (the last 14 days of points, all shifts and trips).

Once you are satisfied, delete the moved-aside folder to get the space back: `dc run --rm --no-deps api rm -r /app/data/before-restore-<time>`.

`milewage-cli restore` is in every version from 0.1.0. Rolling back to an image older than that means the earlier way: start that version on an **empty** `data` volume (keep the old volume until you are sure) and use "Restore from a backup instead" on the setup screen with the same `pre-migration` file.

## What to check afterwards

The restore command (and the restore screen) prints what it found: shifts and their date range, GPS points, stop labels and the new restore generation. Compare them with what you expect, then open a recent shift and check its total.

## Version notes

### 0.2.0

- Run `milewage-cli recalc` once (the command in step 2 above, without `--dry-run`) if shifts were ever created by CSV import: before 0.2.0 their trips never reached the phone.
- A shift with a trip marked personal shows a smaller deduction than in 0.1.0: personal distance no longer counts. Nothing was lost; the earlier figure was wrong.
- Install the new Android app, `milewage-0.2.0.apk` (versionCode 2), on every paired phone. The old app keeps working against the new server, but it sends every phone-added trip without a purpose, which the server parks.
- The Help pages are on by default; Settings > Help pages turns them off.

### 0.3.1

- Install `milewage-0.3.1.apk` (versionCode 4) on every paired phone. It installs over 0.3.0 and keeps everything on the phone: no pairing again, nothing to send first.
- Nothing changes on the server: no migration, no new setting.

### 0.3.0 (the native Android app)

- Install the new Android app, `milewage-0.3.0.apk` (versionCode 3), on every paired phone after the server is upgraded.
- The phone app is a new, native Android app. It installs over the old one but starts empty. Before installing it, open the old app and let it send everything (its banner says when everything is on the server), and end any running shift. Then install the new app, pair it again, and revoke the old entry on the Devices page. It needs Android 8.0 or later.
- The track engine is version 4. Run `milewage-cli recalc --dry-run` to list the shifts the new rule would change; stored shifts keep their figures until they are worked out again.
- Your own mileage rate from before becomes a rate "from the start", with the switch to use it off.
- Phones no longer find the server on the Wi-Fi, so the `lan-discovery` service is gone. If LAN access was on, add `--remove-orphans` to the `up -d` of step 2 once, so its old container stops, and delete the `COMPOSE_PROFILES=lan` line from `infra/docker/.env` (it starts nothing now). LAN access itself and the home address are unchanged.
