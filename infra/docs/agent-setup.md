# Setting up MileWage in Docker: guide for an AI agent

You are an AI coding agent (for example Claude Code) on the machine that will host MileWage. Follow
these steps in order. Run every check and report what it printed. Where a step says **STOP: owner**,
stop and ask the owner; do not work around it. The human guide with the same facts is
[`install.md`](./install.md); upgrades are in [`upgrade.md`](./upgrade.md).

## What you are installing

Two containers from `infra/docker/docker-compose.yml`:

| Container | Does                                                                                  | Limits        |
| --------- | ------------------------------------------------------------------------------------- | ------------- |
| `api`     | the MileWage server (Node 22, SQLite)                                                 | 192 MB, 1 CPU |
| `caddy`   | serves the web app, passes `/api` to the server, published on `127.0.0.1:<port>` only | 64 MB, ½ CPU  |

Data lives in Docker volumes (`data`, `backups`, `config`, `caddy_data`, `caddy_config`). Expect
about 100 MB of RAM in use, about 500 MB for the images, and about 11 MB of data per driver per year
plus up to 17 MB of recent GPS points.

The phone reaches the server through **Tailscale** (https, works on mobile data). Nothing is opened
on the router. **Never run `tailscale funnel`** and never publish the port on `0.0.0.0`.

## Rules

- Do not create the MileWage account and do not read or store the recovery key: the owner does
  that in the browser (step 5). The recovery key decrypts every backup.
- Do not sign in to Tailscale for the owner, and do not change Tailscale settings beyond the one
  `tailscale serve` command in step 4, and only after the owner says yes.
- Do not edit `infra/docker/docker-compose.yml`. Settings go in `infra/docker/.env`.
- Never copy `milewage.db` while the `api` container runs. Use the Backups page instead.
- If a command fails, show its output and stop; do not delete volumes to "start clean".

## 1. Check the host

```bash
docker --version && docker compose version        # Docker with the Compose plugin
uname -m                                           # x86_64 or aarch64 (both work; aarch64 is untested)
free -m | sed -n 2p                                # at least 1024 MB total
df -h . | tail -1                                  # at least 5 GB free
command -v tailscale && tailscale status --json --peers=false | head -20   # optional now, needed in step 4
ss -ltn | grep -E ':(8080)\b' || echo "8080 free"
```

Report the results. Docker missing or under 1 GB RAM: **STOP: owner**.

## 2. Get the code

```bash
git clone <your MileWage repository> milewage
cd milewage
git log --oneline -1
```

This needs an SSH key the Git server accepts. If the clone is refused: **STOP: owner** (they add the
key or give you another URL). Use the `main` branch.

## 3. Start the stack

```bash
infra/install.sh --no-tailscale
```

What it does: checks Docker, writes `infra/docker/.env` (port 8080 or the next free one, and the
proxy subnet), builds both images (the first build takes several minutes), starts them, waits until
they are healthy and checks `/healthz`. It never overwrites an existing `.env`. Options: `--port N`,
`--subnet CIDR`, `--no-start`.

Check:

```bash
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env ps   # both "healthy"
port=$(grep -oP '^MILEWAGE_HOST_PORT=\K.*' infra/docker/.env || echo 8080)
curl -fsS http://127.0.0.1:$port/healthz && echo
curl -fsS http://127.0.0.1:$port/api/v1/setup/status && echo                     # {"state":"needs_setup"}
docker stats --no-stream | grep -i milewage                                         # memory under the limits
```

## 4. Tailscale https address

**STOP: owner.** Ask these, quoting the privacy note:

1. Is Tailscale installed and signed in on this machine (`tailscale status` shows it online)? If not,
   the owner runs `sudo tailscale up` themselves.
2. In the Tailscale admin console (DNS), are **MagicDNS** and **HTTPS certificates** on?
3. **Privacy note:** turning on https publishes this machine's name and the tailnet name in public
   certificate logs. Is the owner happy with the name shown by
   `tailscale status --json --peers=false | grep DNSName`?
4. Does this machine already serve something on Tailscale https? Check `tailscale serve status`.
   `install.sh` serves on the default https port (443); if 443 is taken, the owner picks another
   port and you use the manual commands below.

When the owner says yes and 443 is free:

```bash
infra/install.sh --yes-tailscale
```

It runs `tailscale serve --bg <port>`, writes `MILEWAGE_PUBLIC_URL=https://<name>` to `.env`,
restarts the API and checks `https://<name>/healthz`.

If 443 is taken (example with 8443; use the owner's choice):

```bash
sudo tailscale serve --bg --https=8443 http://127.0.0.1:$port
name=$(tailscale status --json --peers=false | grep -oP '"DNSName":\s*"\K[^"]+' | sed 's/\.$//')
echo "MILEWAGE_PUBLIC_URL=https://$name:8443" >> infra/docker/.env
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d --wait api
curl -fsS https://$name:8443/healthz && echo
```

`tailscale serve` may need `sudo`; if it says "Access denied", **STOP: owner** (they run it, or run
`sudo tailscale set --operator=$USER` once).

## 5. First sign-in

**STOP: owner.** Give them the address (`https://<name>` from step 4, or `http://127.0.0.1:<port>`
on the machine itself) and say:

> Open it, create the owner account, and write down the recovery key on paper or in a password
> manager. Type its last 6 characters to finish. Then follow the setup steps; "Get the app" needs
> step 6 done first.

Wait until they confirm. Then check `curl -fsS http://127.0.0.1:$port/api/v1/setup/status`
(`{"state":"ready"}`).

## 6. The phone app download

The setup wizard's **Get the app** step offers the Android app from this server. The server hands
out `milewage.apk` and `milewage.apk.json` from the `config` volume. Get both files one of these
ways:

- **Build here** (only if this host has Node 22, JDK 17 and the Android SDK):
  `scripts/phone-release-build.sh --publish /tmp/mw/milewage.apk` (add
  `-PreactNativeArchitectures=arm64-v8a` for a smaller, faster build for 64-bit phones).
- **Copy from the development machine** (ask the owner where the latest build is), for example
  `scp <dev-host>:<path>/milewage.apk <dev-host>:<path>/milewage.apk.json /tmp/mw/`.

Then:

```bash
for f in milewage.apk milewage.apk.json; do
  docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env cp /tmp/mw/$f api:/app/config/$f
done
curl -fsSI http://127.0.0.1:$port/api/v1/app/android.apk | head -3   # 200 and a content-length
```

No restart is needed. Without the files, the download is simply not offered.

## 7. Optional settings

Add to `infra/docker/.env`, then
`docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d --wait api`:

| Setting                            | When                                                            |
| ---------------------------------- | --------------------------------------------------------------- |
| `MILEWAGE_MODULE_MCP=1`            | the owner wants AI assistants (then see `install.md` section 7) |
| `MILEWAGE_APP_STORE_URL=https://…` | once the app is on Google Play (must be https)                  |

## 8. Moving existing data (optional)

Only on a fresh install, before step 5: the owner downloads a backup from the old server's
Backups page, then on the new setup screen chooses **Restore from a backup instead**, uploads it and
enters that server's recovery key. **STOP: owner** for the whole step; you only confirm the counts
the restore screen prints.

## 9. Final check and report

```bash
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env ps
docker stats --no-stream | grep -i milewage
docker volume ls | grep -i milewage
grep -v -i -E 'secret|token|key' infra/docker/.env
```

Report to the owner: the address, the host port, whether Tailscale https works, whether the APK is
offered, memory in use, and anything you stopped on.

## Upgrading later

```bash
cd milewage && git pull
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d --build --wait
curl -fsS http://127.0.0.1:$port/healthz && echo
```

Ask the owner to download a backup first (Backups page). The server makes its own pre-migration
backup before changing the database. Replace the APK (step 6) after each upgrade so phone and server
match. Rollback and failure cases: [`upgrade.md`](./upgrade.md).

## Troubleshooting

| Symptom                                | Look at / do                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| a container is not healthy             | `docker compose … logs --tail 100 api` (or `caddy`)                                                            |
| port 8080 busy                         | `infra/install.sh --port 8090 --no-tailscale` (only before `.env` exists; otherwise edit `MILEWAGE_HOST_PORT`) |
| `https://<name>` does not resolve      | the device is not on Tailscale, or MagicDNS is off (owner)                                                     |
| pairing QR points at the wrong address | `MILEWAGE_PUBLIC_URL` in `.env`, then restart `api`                                                            |
| writes answer 503 `read_only_mode`     | a pre-migration backup failed, usually disk space; see `upgrade.md`                                            |
| out of memory kills                    | `docker stats`; the limits are in the compose file, the host needs ≥ 1 GB                                      |
