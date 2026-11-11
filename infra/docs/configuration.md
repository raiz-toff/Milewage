# Server settings reference

Every `MILEWAGE_*` setting, what it does, its default and where it is set. Most people never touch any of them: `infra/install.sh` writes the few the Docker stack needs. Read [`install.md`](./install.md) first.

## How settings are read

- **Docker stack.** You put settings in `infra/docker/.env`. The compose file passes some of them on to the containers, sometimes under another name (`MILEWAGE_PROXY_SUBNET` becomes the API's `MILEWAGE_TRUST_PROXY`). A setting the compose file does not pass on never reaches the API: add it under `api:` › `environment:` in your own copy of the compose file.
- **Settings file.** Some settings can also go in `settings.json` in the `config` volume (`/app/config/settings.json`). It is optional; a missing file means all defaults.
- **Order.** The built-in default, then `settings.json`, then the environment. The environment wins. An empty value (`MILEWAGE_MODULE_MCP=`) counts as not set.
- **Switches** take `0` (off) or `1` (on), in the environment, or `true` / `false` in `settings.json`. Anything else stops the server at start with a message that names the setting.
- Settings are read once, at start. After a change to `.env`: `docker compose --env-file infra/docker/.env -f infra/docker/docker-compose.yml up -d` (it recreates the changed containers). After a change to `settings.json`: `docker compose -f infra/docker/docker-compose.yml restart api`.

"Default" below is the value in the code. Where the Docker image or the compose file sets another value, both are given.

## 1. Server runtime

The Docker image sets the first four itself. A driver never changes them: Caddy and the health check expect the API on port 3000, and the volumes are mounted at these folders.

| Setting               | What it does                                                                           | Default                                                                    | Where it is set                                                   |
| --------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `MILEWAGE_PORT`       | Port the API listens on (0 to 65535).                                                  | `8080`; the image sets `3000`                                              | Dockerfile; `npm run dev` sets `3000` (or `MILEWAGE_DEV_PORT`)    |
| `MILEWAGE_HOST`       | Address the API listens on.                                                            | `0.0.0.0`                                                                  | not set in Docker; `npm run dev` sets `127.0.0.1`                 |
| `MILEWAGE_DATA_DIR`   | Folder of `milewage.db` and `diagnostics.db`.                                          | `data` (in the folder the server started from); the image sets `/app/data` | Dockerfile; `milewage-cli` assumes `/app/data` when it is not set |
| `MILEWAGE_CONFIG_DIR` | Folder of `secrets.json`, `settings.json` and `milewage.apk`.                          | `config`; the image sets `/app/config`                                     | Dockerfile; `milewage-cli restore` assumes `/app/config`          |
| `MILEWAGE_LOG_LEVEL`  | How much the API logs: `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. | `info`                                                                     | not set in Docker; `npm run dev` uses `warn`                      |

## 2. Backups

| Setting                        | What it does                                                                                                                  | Default                                                          | Where it is set                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| `MILEWAGE_BACKUP_DIR`          | Folder of the encrypted backups.                                                                                              | `backups` next to the data folder; the image sets `/app/backups` | Dockerfile                                                |
| `MILEWAGE_BACKUP_ON_SHIFT_END` | Switch: a verified backup after a shift ends, at most one every 15 minutes.                                                   | on                                                               | `settings.json` `backup.on_shift_end`, or the environment |
| `MILEWAGE_BACKUP_DOWNLOAD`     | Switch: downloading a backup file from the Backups page (`GET /backups/{id}/download`). Off: backups stay on the server only. | on                                                               | `settings.json` `backup.download`, or the environment     |

The nightly backup has no setting: it always runs, at 03:30 in the owner's time zone.

## 3. Diagnostics

| Setting                       | What it does                                                   | Default | Where it is set                                          |
| ----------------------------- | -------------------------------------------------------------- | ------- | -------------------------------------------------------- |
| `MILEWAGE_DIAGNOSTICS_BUNDLE` | Switch: the debug bundle download (`GET /diagnostics/bundle`). | on      | `settings.json` `diagnostics.bundle`, or the environment |

The diagnostics module itself is a module switch (section 5). How much a phone records is a setting in the web, not here.

## 4. Network and addresses

The first four, and `MILEWAGE_TRUSTED_PROXIES`, are compose settings in `infra/docker/.env`; the API never sees them by these names. `install.sh` writes `MILEWAGE_HOST_PORT`, `MILEWAGE_PROXY_SUBNET` and `MILEWAGE_PROXY_GATEWAY` on the first run, and `MILEWAGE_BIND_ADDRESS` and `MILEWAGE_HOME_URL` with `--lan` or `--no-lan`. It adds `MILEWAGE_PUBLIC_URL` after the Tailscale step.

| Setting                    | What it does                                                                                                                                                                                                                                                                                         | Default                                                                                                        | Where it is set                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `MILEWAGE_HOST_PORT`       | Host port Caddy is published on. Also the port `lan-discovery` announces.                                                                                                                                                                                                                            | `8080` in the compose file; `install.sh` takes the next free port if 8080 is busy                              | `.env` (`install.sh --port`)                                 |
| `MILEWAGE_BIND_ADDRESS`    | Host address Caddy is published on. `127.0.0.1`: this host only. `0.0.0.0`: every interface (LAN access, `install.md` section 2a).                                                                                                                                                                   | `127.0.0.1`                                                                                                    | `.env` (`install.sh --lan` / `--no-lan`)                     |
| `MILEWAGE_PROXY_SUBNET`    | The stack's own Docker network. The compose file also passes it to the API as `MILEWAGE_TRUST_PROXY`.                                                                                                                                                                                                | `172.29.88.0/24`                                                                                               | `.env` (`install.sh --subnet`)                               |
| `MILEWAGE_PROXY_GATEWAY`   | Gateway of that network. Caddy keeps the forwarded headers (from `tailscale serve`) only from this address. Change it with the subnet.                                                                                                                                                               | `172.29.88.1` in the compose file and the Caddyfile                                                            | `.env` (`install.sh` writes the subnet's first address)      |
| `MILEWAGE_TRUSTED_PROXIES` | Your own reverse proxy in front of Caddy (`install.md` section 7a): addresses or ranges separated by spaces. Caddy keeps its forwarded headers too, so MileWage sees the https the browser used; the compose file also adds it to the API's `MILEWAGE_TRUST_PROXY`.                                  | empty: no proxy of your own                                                                                    | `.env`                                                       |
| `MILEWAGE_TRUST_PROXY`     | Proxy addresses or ranges (separated by commas or spaces, or `true` for all) whose `X-Forwarded-For` the API believes. Without it every login limit would see Caddy's address.                                                                                                                       | empty: no proxy is trusted; the compose file sets it to `MILEWAGE_PROXY_SUBNET` and `MILEWAGE_TRUSTED_PROXIES` | compose file; set the subnet, not this                       |
| `MILEWAGE_PUBLIC_URL`      | The address phones are given in pairing codes, for example `https://<host>.<tailnet>.ts.net`. Must be `https://` with nothing after the host name (`http://` only outside production). AI assistants that come for this host name are given it as written, https included (`install.md` section 7a). | empty: the address the browser is on                                                                           | `.env` (`install.sh` Tailscale step, `install.md` section 3) |
| `MILEWAGE_HOME_URL`        | The server's address on the home network, for example `http://192.168.1.20:8080`. Must be a private address or a `.local` name.                                                                                                                                                                      | empty: none known                                                                                              | `.env` (`install.sh --lan`); `npm run dev --host` sets it    |
| `MILEWAGE_LAN_IP`          | Read by `install.sh` only: this host's home address, when it cannot find it by itself.                                                                                                                                                                                                               | the source address of the default route                                                                        | the shell, when running `install.sh --lan`                   |
| `MILEWAGE_ADVERTISE_PORT`  | Read by `lan-discovery`: the port it announces on the Wi-Fi.                                                                                                                                                                                                                                         | `8080`; the compose file passes `MILEWAGE_HOST_PORT`                                                           | compose file                                                 |
| `MILEWAGE_HEALTH_URL`      | Read by `lan-discovery`: where it checks that the server is up before it announces it.                                                                                                                                                                                                               | `http://127.0.0.1:<announced port>/healthz`                                                                    | not set in Docker; `npm run dev` sets it                     |
| `MILEWAGE_ADVERTISE_NAME`  | Read by `lan-discovery`: the name phones show.                                                                                                                                                                                                                                                       | `MileWage (<host name>)`                                                                                       | not set anywhere; set it by hand if you want another name    |
| `MILEWAGE_LAN_DISCOVERY`   | Read by `npm run dev` only: `0` turns off the home address and the Wi-Fi announcement of the dev server.                                                                                                                                                                                             | on                                                                                                             | the shell                                                    |

`COMPOSE_PROFILES=lan` in `.env` is Docker's own setting, not MileWage's: it starts the `lan-discovery` service.

## 5. Modules

| Setting                           | What it does                                                                                                                                       | Default                                                                   | Where it is set                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `MILEWAGE_MODULE_<NAME>`          | Switch: turns a module on or off. `<NAME>` is the module name in capitals, for example `MILEWAGE_MODULE_TAX=0`.                                    | see below                                                                 | `settings.json` `modules.<name>`, or the environment             |
| `MILEWAGE_MODULE_MCP`             | The same switch for the AI assistant endpoint and its sign-in (`install.md` section 7). The only module switch the compose file passes to the API. | on; off on a server set up before 0.2.0 that never made an assistant code | `.env`; the compose file passes it on (empty leaves the default) |
| `MILEWAGE_MODULE_EXPORT_<FORMAT>` | Switch: offers one export format or hides it. Formats: `CSV`, `GPX`, `GEOJSON`, `EXPENSES`, `TAX_SUMMARY`.                                         | all on                                                                    | `settings.json` `modules.export_<format>`, or the environment    |

Modules on by default: `devices`, `tracking`, `stops`, `replay`, `sync`, `exporters`, `diagnostics`, `platforms`, `earnings`, `expenses`, `receipts`, `goals`, `analytics`, `maintenance`, `import`, `notifications`, `tax`, `mcp` (but see its row above).
Off by default: `capture`.
`core` and `backup` cannot be turned off. A module whose dependency is off stops the server at start with a message that names both (for example `receipts` needs `expenses`).

Apart from `MILEWAGE_MODULE_MCP`, a module switch in `.env` does not reach the API. Use `settings.json`, for example `{ "modules": { "tax": false } }`.

## 6. Tax and country options

| Setting                      | What it does                                                                                                                                                | Default   | Where it is set                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| `MILEWAGE_TAX_COUNTRIES`     | Countries whose tax estimate is shown, comma-separated, for example `CA`. It can only hide an estimate: a country without a checked tax pack shows nothing. | `CA`      | `settings.json` `comma.tax_countries` (a list), or the environment |
| `MILEWAGE_EARNINGS_OVERRIDE` | A platform total typed for a shift `replace`s the sum of that platform's entries, or is added to it (`sum`).                                                | `replace` | `settings.json` `comma.earnings_override`, or the environment      |

## 7. Phone app download

| Setting                  | What it does                                                                            | Default                                                          | Where it is set                                                 |
| ------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `MILEWAGE_APP_STORE_URL` | The app's store page (an `https://` link). The download page then offers it first.      | empty: not offered                                               | `.env`; the compose file passes it on (`install.md` section 3a) |
| `MILEWAGE_APK_PATH`      | The Android app file the server hands out. Read on every request; no file, no download. | `milewage.apk` in the config folder (`/app/config/milewage.apk`) | not set in Docker; copy the file to the default place instead   |

## 8. Release and build

None of these are server settings. They are read by the build scripts, the release compose file and CI.

| Setting                      | What it does                                                                                                | Default                                                | Where it is set                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| `MILEWAGE_IMAGE_REPO`        | Registry path of the published images, for `docker-compose.release.yml`.                                    | none: the release file refuses to start without it     | `.env` (`install.md`, "Run from published images")      |
| `MILEWAGE_VERSION`           | Release tag of the published images, for example `v0.1.0`.                                                  | `latest` (pin a version instead)                       | `.env`                                                  |
| `MILEWAGE_VERSION_CODE`      | Android `versionCode` of the phone app (1 to 2100000000). Raise it for every build handed out.              | the default in `apps/android/app/build.gradle.kts` (3) | by hand, for `scripts/phone-release-build.sh`           |
| `MILEWAGE_APK_PUBLISH`       | Where `scripts/phone-release-build.sh` copies the built app (same as `--publish`).                          | empty: not copied                                      | the shell                                               |
| `MILEWAGE_KEYSTORE_ENV`      | File holding the four signing settings below.                                                               | `$HOME/.milewage/keystore.env`                         | the shell (the key never goes to CI)                    |
| `MILEWAGE_KEYSTORE_PATH`     | The upload keystore. Without it the release app is signed with the Android debug key (not for Google Play). | empty: debug key                                       | `keystore.env` (written by `scripts/phone-keystore.sh`) |
| `MILEWAGE_KEYSTORE_PASSWORD` | The keystore's password.                                                                                    | none                                                   | `keystore.env`                                          |
| `MILEWAGE_KEY_ALIAS`         | The key's alias in the keystore.                                                                            | none                                                   | `keystore.env`                                          |
| `MILEWAGE_KEY_PASSWORD`      | The key's password.                                                                                         | none                                                   | `keystore.env`                                          |
| `MILEWAGE_INSTALL_RETRY_S`   | Seconds `install.sh` waits between checks of the https address.                                             | `3`                                                    | the tests only                                          |

## 9. Names you may see that are not settings

- `MILEWAGE_MODE=home-lab` is in the compose file. The server does not read it today; plan 10 keeps it for choosing the Caddyfile of a future public mode.
- `MILEWAGE_AUTH` is in the Claude Desktop example of `install.md` section 7. It lives in that computer's Claude config, not on the server.
- `NODE_ENV=production` (set by the image and the compose file) is Node's own setting. In production the server refuses a plain `http://` `MILEWAGE_PUBLIC_URL`.
