# Install guide: home lab with Tailscale

For a home server or Raspberry Pi that runs MileWage in Docker and is reached from the phone through Tailscale. Nothing is opened on your router. Specs behind this guide: `plans/milewage/10-backup-restore-and-ops-spec.md` sections 2, 3, 8, 9.

**Status of this guide.** The script and the commands below were run on a development machine with Docker 29 (see `plans/milewage/progress.md`). They have **not** been followed on a fresh VM or a Pi, on ARM, or with a real tailnet: the roadmap's M10.1 exit ("guide followed on a fresh VM") is still open and belongs to the Human.

## 1. What you need

- A host with Docker and the Docker Compose plugin (`docker compose version` works), 1 GB RAM, and a few GB of disk. The stack is capped at 192 MB for the API and 64 MB for Caddy.
- A tailnet (a free Tailscale account) and the Tailscale app on your phone.
- About 10 minutes, most of it the first image build.

## 2. Start MileWage

```bash
git clone <your MileWage repository> milewage && cd milewage
infra/install.sh
```

The script checks Docker, writes `infra/docker/.env` with the host port (default 8080, the next free port if 8080 is busy) and the proxy subnet, builds and starts the two containers, waits until they are healthy, and checks `/healthz`. It never overwrites an existing `.env`. `infra/install.sh --no-start` only writes the file. Options: `--port N`, `--subnet CIDR`.

The web client is now at `http://127.0.0.1:8080` on the host. The port is published on loopback only.

**First run in the browser.** Create the owner account (username, password of at least 10 characters, country, distance unit, currency, time zone). The next screen shows a **recovery key**. Write it on paper or save it in a password manager. It decrypts your backups and is not stored anywhere else: the server keeps only its public half and cannot show it again. Type its last 6 characters to finish setup. Until you do, every other page answers "setup incomplete".

## 3. Reach it from the phone: Tailscale on the host

1. Install Tailscale on the host and sign in. Install the Android app and sign in to the same tailnet.
2. **Privacy note, read before the next step.** Turning on HTTPS certificates publishes your machine name and tailnet name on a public certificate log (Tailscale's HTTPS documentation). Give the host a name you are happy to have public (not your name, address or employer) and use a tailnet name you accept being public.
3. In the Tailscale admin page, DNS settings: make sure MagicDNS is on, then enable HTTPS certificates.
4. On the host: `tailscale serve --bg 8080` (use your port if it is not 8080). The phone reaches MileWage at `https://<host>.<tailnet>.ts.net`. The first request can be slow while the certificate is issued.
5. In the web client, Devices, create a pairing QR code and scan it from the MileWage app on the phone.

Unverified (spec 10 section 8, Spike D): the source address Caddy sees from `tailscale serve`. If login or pairing is rate limited for everyone at once, that is the place to look.

### 3a. The phone app from your own server

The web's **Get the app** link downloads the Android app from your server (`GET /api/v1/app/android.apk`, no sign-in). The server hands out whatever file is at `MILEWAGE_APK_PATH`, by default `milewage.apk` in the `config` volume; with no file there, the link is hidden. To put the app built from the same checkout there:

1. `scripts/phone-release-build.sh` (needs Node 22, JDK 17 and the Android SDK) makes `apps/phone/android/app/build/outputs/apk/release/app-release.apk`.
2. `docker compose -f infra/docker/docker-compose.yml cp apps/phone/android/app/build/outputs/apk/release/app-release.apk api:/app/config/milewage.apk`

Replace the file the same way after an upgrade, so the phone and the server stay on the same version. Android asks the driver to allow installing apps from the browser the first time.

## 4. Backups

Backups run nightly and after a shift ends; the Backups page lists them and shows the off-site reminder. Download an encrypted copy now and then to another machine: a backup on the same disk is not a backup (10 section 6). Restoring on a fresh instance: on the setup screen choose "Restore from a backup instead", upload the file and enter the recovery key.

## 5. Where things live

| Volume                       | Holds                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `data`                       | `milewage.db` (your records), `diagnostics.db` (disposable)                             |
| `backups`                    | encrypted `.db.gz.age` files, `pre-migration/`, `pre-restore/`                          |
| `config`                     | `secrets.json` (the public key only), optional `settings.json`, optional `milewage.apk` |
| `caddy_data`, `caddy_config` | Caddy state                                                                             |

Never copy `milewage.db` by hand while the API runs. Logs rotate (3 files of 10 MB per container): `docker compose -f infra/docker/docker-compose.yml logs api`.

## 6. Check that it works

`infra/docker/smoke.sh` builds a throwaway stack on port 18080 and checks health, the web client, loopback-only publishing and log rotation (needs Docker; exits 2 when Docker is missing). The numbers in `infra/vm-tests/README.md` are for the real VM acceptance runs.
