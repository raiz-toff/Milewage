# Install guide: home lab with Tailscale

For a home server or Raspberry Pi that runs MileWage in Docker and is reached from the phone through Tailscale. Nothing is opened on your router. Specs behind this guide: `plans/milewage/10-backup-restore-and-ops-spec.md` sections 2, 3, 8, 9.

**Status of this guide.** The script and the commands below were run on a development machine with Docker 29 (see `plans/milewage/progress.md`). They have **not** been followed on a fresh VM or a Pi, on ARM, or with a real tailnet: the roadmap's M10.1 exit ("guide followed on a fresh VM") is still open and belongs to the Human.

Setting it up with an AI coding agent? Give it [`agent-setup.md`](./agent-setup.md): the same steps with checks to run, and the points where it must stop and ask you.

## 1. What you need

- A host with Docker and the Docker Compose plugin (`docker compose version` works), 1 GB RAM, and a few GB of disk. The stack is capped at 192 MB for the API and 64 MB for Caddy.
- A tailnet (a free Tailscale account) and the Tailscale app on your phone.
- About 10 minutes, most of it the first image build.

## 2. Start MileWage

```bash
git clone <your MileWage repository> milewage && cd milewage
infra/install.sh
```

The script checks Docker, writes `infra/docker/.env` with the host port (default 8080, the next free port if 8080 is busy) and the proxy subnet, builds and starts the two containers, waits until they are healthy, and checks `/healthz`. It never overwrites an existing `.env`. `infra/install.sh --no-start` only writes the file. Options: `--port N`, `--subnet CIDR`, `--yes-tailscale`, `--no-tailscale`.

Then it does the Tailscale step of section 3 for you when it can: if Tailscale is installed and this host is signed in and has HTTPS certificates on, it shows the machine name that will become public (read the privacy note in section 3), asks `Turn on https for <name>? [y/N]`, runs `tailscale serve --bg <port>`, writes `MILEWAGE_PUBLIC_URL=https://<name>` to `.env`, restarts the API and checks the address. Otherwise it says which step is missing (install Tailscale, `sudo tailscale up`, or turn on HTTPS certificates in the admin console) and stops without changing anything. It never installs Tailscale and never runs `tailscale funnel`. `--yes-tailscale` answers yes; `--no-tailscale` skips the step.

The web client is now at `http://127.0.0.1:8080` on the host. The port is published on loopback only.

**First run in the browser.** Create the owner account (username, password of at least 10 characters, country, distance unit, currency, time zone). The next screen shows a **recovery key**. Write it on paper or save it in a password manager. It decrypts your backups and is not stored anywhere else: the server keeps only its public half and cannot show it again. Type its last 6 characters to finish setup. Until you do, every other page answers "setup incomplete".

## 3. Reach it from the phone: Tailscale on the host

1. Install Tailscale on the host and sign in. Install the Android app and sign in to the same tailnet.
2. **Privacy note, read before the next step.** Turning on HTTPS certificates publishes your machine name and tailnet name on a public certificate log (Tailscale's HTTPS documentation). Give the host a name you are happy to have public (not your name, address or employer) and use a tailnet name you accept being public.
3. In the Tailscale admin page, DNS settings: make sure MagicDNS is on, then enable HTTPS certificates.
4. On the host: `tailscale serve --bg 8080` (use your port if it is not 8080). The phone reaches MileWage at `https://<host>.<tailnet>.ts.net`. The first request can be slow while the certificate is issued.
5. Tell MileWage its address: add `MILEWAGE_PUBLIC_URL=https://<host>.<tailnet>.ts.net` to `infra/docker/.env`, then `docker compose --env-file infra/docker/.env -f infra/docker/docker-compose.yml up -d`. Pairing codes then carry this address whichever address your browser is on. Without it, the code carries the address in your browser's address bar, so open MileWage at the `https://…ts.net` address to pair.
6. In the web client, Devices, create a pairing QR code and scan it from the MileWage app on the phone. Under the code, "Your phone will connect to" shows the address; **Change address** fixes a wrong one for that code.

`tailscale serve` reaches Caddy through the Docker gateway of the stack's network (`MILEWAGE_PROXY_GATEWAY`, by default `172.29.88.1`, the first address of `MILEWAGE_PROXY_SUBNET`). Caddy trusts the forwarded headers from that address only, so the pairing code says `https://<host>.<tailnet>.ts.net` and the rate limits see the phone's own tailnet address. If you change the subnet by hand, change the gateway with it (`install.sh --subnet` writes both).

### 3a. The phone app from your own server

The setup wizard's **Get the app** step and the Devices page show a QR code for the download page, `https://<your address>/app`. It needs no sign-in (the phone has no account yet) and offers:

- **Get it on Google Play**, once the app is published and `MILEWAGE_APP_STORE_URL` is set (in `infra/docker/.env`, for example `MILEWAGE_APP_STORE_URL=https://play.google.com/store/apps/details?id=app.milewage.phone`; it must be an https link);
- **Download the app** (or "or download it directly" under the store link): the Android app file from your own server (`GET /api/v1/app/android.apk`), with its size, version and date.

The server hands out whatever file is at `MILEWAGE_APK_PATH`, by default `milewage.apk` in the `config` volume, and reads `milewage.apk.json` beside it for the version. It looks at the file on every request, so a new one is offered at once, without a restart. With no file there, the download is not offered. To put the app built from the same checkout there:

1. `scripts/phone-release-build.sh --publish <path>` (needs Node 22, JDK 17 and the Android SDK) builds the app and copies it to `<path>` with its `.json` (`MILEWAGE_APK_PUBLISH=<path>` does the same). To publish an app you already built: `scripts/publish-apk.sh apps/phone/android/app/build/outputs/apk/release/app-release.apk <path>`.
   - For `npm run dev`: `<path>` is `.dev/config/milewage.apk`, and that is all.
   - For the Docker stack: publish to a folder of your choice, for example `/tmp/mw/milewage.apk`, then copy both files in:
     `docker compose -f infra/docker/docker-compose.yml cp /tmp/mw/milewage.apk api:/app/config/milewage.apk` and the same for `milewage.apk.json`.

Replace the file the same way after an upgrade, so the phone and the server stay on the same version. The first time, Android asks the driver to allow the browser to install apps ("Install unknown apps", then "Allow from this source"); the download page says so.

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

## 7. Connect an AI assistant (optional)

MileWage can let an AI assistant such as Claude read your records and add to them, over the Model Context Protocol (plan 26). It is **off** until you turn it on:

1. In `infra/docker/.env` add `MILEWAGE_MODULE_MCP=1` (or put `{ "modules": { "mcp": true } }` in `settings.json` in the `config` volume), then `docker compose -f infra/docker/docker-compose.yml up -d --wait api`.
2. In MileWage open **Settings › AI assistants**, give the token a name, choose **Read only** or **Read and change**, and press **Make a token**. Copy it at once: it is shown only this time. The page also shows the two commands below with your address and token filled in.
3. Connect from a computer in your tailnet (the endpoint is `https://<your address>/api/v1/mcp`):
   - **Claude Code:** `claude mcp add --transport http milewage https://<your address>/api/v1/mcp --header "Authorization: Bearer mwa_…"`
   - **Claude Desktop:** Settings › Developer › Edit config, and add to `claude_desktop_config.json`:
     ```json
     {
       "mcpServers": {
         "milewage": {
           "command": "npx",
           "args": [
             "-y",
             "mcp-remote@0.15.2",
             "https://<your address>/api/v1/mcp",
             "--header",
             "Authorization:${MILEWAGE_AUTH}"
           ],
           "env": { "MILEWAGE_AUTH": "Bearer mwa_…" }
         }
       }
     }
     ```
     (needs Node.js on that computer; restart Claude Desktop afterwards).
4. Ask, for example, "How much did I make per hour last week?" or "Add a $54.20 fuel expense from Esso today". Your assistant asks before each change unless you allowed it.

Revoke a token on the same page as soon as you stop using it; changes made by assistants are listed there too. claude.ai's own connectors reach servers from the internet, not from your tailnet, so they cannot connect to a Tailscale-only MileWage; do not open the endpoint with `tailscale funnel` for them.
