# VM tests: Spike B B1-B17 against the product server

Ported from the throwaway rig in `milewage-spikes/B` (roadmap `17` M3.6). They drive the **shipped compose stack** (`infra/docker/docker-compose.yml`, plus the small override `docker-compose.vm.yml`) through the **real API**: first-run setup, sign-in, pairing, `POST /telemetry/batch`, `POST /backups`, `POST /setup/restore`, `GET /system/status`. There are no test hooks in the product. Anything the API cannot show is read with a read-only SQLite connection inside the `api` container (allowed next to the single write connection).

**Nothing here is a result.** The numbers that count come from the 1 vCPU / 1 GB Proxmox VM. Run them by hand and write `plans/milewage/spikes/B-results.md` from `artifacts/`.

## What differs from the spike rig (and why)

| Spike rig                                                    | Product                                                                                                                                                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One static bearer token                                      | Owner account, session cookie, **56 paired phones** for B3 (each phone is limited to 60 batches a minute, so 50 req/s needs about 56)                                                                |
| `_spike/*` hooks (counts, integrity, restore, second writer) | Read-only SQL in the container; restore through `POST /setup/restore`; the second writer is a small script in the container                                                                          |
| Backup triggered at will                                     | `POST /backups` is limited to one per 15 minutes; the runner waits for the slot (B5, B8, B14, B15, B16 are slow because of it)                                                                       |
| Route-history read for B4                                    | That route (`replay` module) does not exist yet; the reader calls `GET /shifts/{id}` and `GET /shifts?limit=200` once a second                                                                       |
| `live`, `replay` module flags (B13)                          | The modules that exist: `tracking`, `devices`, `diagnostics`                                                                                                                                         |
| B9 with a bundled "version 2"                                | A pending migration is made by forgetting that `core/0006` was applied; the forced failure leaves its column in place so `ALTER TABLE ADD COLUMN` fails, then the column is dropped for the real run |
| B16 loop lag                                                 | The server reports none; recorded as "not measured"                                                                                                                                                  |

## One-time VM setup

Follow `milewage-spikes/B/README.md` "Proxmox VM setup" (Debian 12, 1 vCPU, 1024 MiB with ballooning off, 20 GB no-cache disk, Docker, **Node 22.22 or newer on the host**, `apt install age`), then:

```bash
git clone <repo> && cd milewage        # the host needs no npm install: the runner uses only Node built-ins
docker compose -p mwvm -f infra/docker/docker-compose.yml -f infra/vm-tests/docker-compose.vm.yml up -d --build --wait
```

Take the Proxmox snapshots `snap0-tools`, and `pre-bNN` before each destructive test (b06, b07, b08, b09, b10, b13) and roll back afterwards. Force-stop for B7 is `qm stop <vmid>` on the Proxmox host (not Shutdown or Reboot).

Defaults: URL `http://127.0.0.1:8080` (Caddy, the path Tailscale `serve` would use), compose project `mwvm`. Override with `BASE`, `MILEWAGE_HOST_PORT`, `VM_PROJECT`. Output goes to `infra/vm-tests/artifacts/` (not committed). `DRY_RUN=1` prints the docker commands without running them. The runner remembers the owner and the recovery key in `artifacts/session.json`.

## Run order

`node infra/vm-tests/run.mjs list` prints every test. Exit code 0 pass, 1 a FAIL, 2 a test error.

| Step | Command                                                                                                                    | Wall time                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1    | `b12` SQLite version                                                                                                       | seconds                                     |
| 2    | `b01` idle footprint (`B1_MINUTES` shortens)                                                                               | 30 min                                      |
| 3    | `b02` realistic load, 8 h scaled 60x (`B2_MINUTES`)                                                                        | 8 min                                       |
| 4    | `b03` 50 req/s x 200 points (`B3_SECONDS`)                                                                                 | 10 min                                      |
| 5    | `b04` B3 plus a reader (`B4_SECONDS`)                                                                                      | 5 min                                       |
| 6    | `b05` backup under load (`B5_SECONDS`)                                                                                     | 4 min + backup                              |
| 7    | `b15` B5b: backup with one writer, then with a second writing connection (`B15_CAP_SECONDS`)                               | about 40 min (waits 15 min between backups) |
| 8    | `b14` encrypted backup opens with the Go `age` tool                                                                        | few min                                     |
| 9    | `b16` B3 plus 50 diagnostics events/s plus a backup (`B16_SECONDS`)                                                        | 4 min + backup                              |
| 10   | `b17` diagnostics module on vs off, idle (`B17_MINUTES` each)                                                              | 60 min                                      |
| 11   | `b13` module flags. Snapshot first                                                                                         | 2 min                                       |
| 12   | `b06` `kill -9` mid-batch. Snapshot first                                                                                  | 1 min                                       |
| 13   | `b07 start`, then `qm stop <vmid>`, start the VM, `docker compose ... up -d` if needed, `b07 check`. Snapshot first        | about 5 min                                 |
| 14   | `b08` restore drill on a fresh host (runs `down -v`). Snapshot first                                                       | few min                                     |
| 15   | `b09 seed`, then `b09 run` (forced failure, then the real migration, on about 1 GB; needs about 6 GB free). Snapshot first | 10-20 min                                   |
| 16   | `b10 prepare`, then `b10` (see below)                                                                                      | 5 min                                       |
| 17   | `b11` informational write volume                                                                                           | 5 min                                       |

**B10 setup** (a small filesystem so filling it is cheap):

```bash
fallocate -l 1500M /srv/b10.img && mkfs.ext4 -F /srv/b10.img && mkdir -p /srv/b10 && mount -o loop /srv/b10.img /srv/b10
export DATA_SRC=/srv/b10
node infra/vm-tests/run.mjs b10 prepare    # fresh stack on the small volume, about 150 MB of seeded points
node infra/vm-tests/run.mjs b10
```

## Known limits

- B9: the Docker `HEALTHCHECK` allows a 10 s start period, but the pre-migration backup of a 1 GB database comes first, so the container may be reported unhealthy meanwhile. The runner only waits; the roadmap decides afterwards whether to listen first.
- The integrity check of a backup copy runs on the main thread (spike finding 2). B5 shows whether it stalls writes beyond 1 s; the worker-thread fallback is not built.
- `bytes written per driving hour` (B11) is informational: SD-card wear is deferred (`12` section 16).
- Run `npm run verify` on a development machine for the dry-run self-checks (`vm-tests.test.mjs`): they run the generator against an in-process server and check the compose override with `docker compose config`.
