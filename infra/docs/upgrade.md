# Upgrade and rollback

Specs: `plans/milewage/10-backup-restore-and-ops-spec.md` sections 10 and 3.1. The drill that proves the failure path is test **b09** of `infra/vm-tests` (see its README); it has been run on a development machine with a forced failure and a 300,000-row database, not yet on the target VM.

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

Migrations only go forward, so a rollback means going back to the version's data:

1. Put the previous image tag / repository version back and **do not start it against the upgraded database**.
2. Restore the latest `pre-migration/` backup. Anything written after the upgrade is lost, and the web client says so before you confirm.

**Gap, stated plainly:** the spec's tool for step 2 is `milewage-cli restore --file=...`. That command is **not built**. The only restore that exists is `POST /setup/restore` (the "Restore from a backup instead" screen), which works only while no user exists, so today a rollback means starting the old version on an **empty `data` volume** (rename or remove the old volume first, keep it until you are sure) and restoring the `pre-migration` file there with your recovery key. The file is in the `backups` volume under `pre-migration/`. Building `milewage-cli restore` (10 section 7) is the open item that makes this a single command.

## What to check afterwards

The restore screen prints the counts it found (shifts, stop labels, points, date range). Compare them with what you expect, then open a recent shift and check its total.
