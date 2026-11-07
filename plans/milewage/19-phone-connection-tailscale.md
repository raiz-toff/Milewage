# 19 — Phone Connection over Tailscale

**Lead Agent:** Agent 2 (Self-Hosted Docker & Backend Architect) with Agents 1 and 4
**Status:** Building (2026-11-07): T1 done (`pr-T1-caddy-trusted-proxies`), T2 done (`pr-T2-public-url`); T6's Vite part done. The rest below is not built yet.
**Parent:** [`plans/milewage/README.md`](./README.md) · Builds on decision 1.7 (`06`) and [`10`](./10-backup-restore-and-ops-spec.md) §8 · Amends [`08`](./08-api-spec.md) §2.4, [`10`](./10-backup-restore-and-ops-spec.md) §8.1, [`15`](./15-offline-storage-and-sync-spec.md) §9.4, [`17`](./17-gate4-execution-roadmap.md) M10.1, `infra/docs/install.md` §3

Tailscale was chosen as the way the phone reaches the home server on 2026-11-03 (decision 1.7). This plan turns that decision into a feature a driver can follow from start to finish, and fixes what stops it working today.

---

## 1. Goal

A driver with a home server and the **release** phone app:

1. follows the install guide (or the install script) and gets `https://<host>.<tailnet>.ts.net`;
2. opens the web app, presses **Pair a phone** and scans the QR;
3. the phone pairs and keeps syncing on Wi-Fi **and** mobile data;
4. when something is wrong, the phone or the web says **which step** is wrong, instead of "Cannot reach the server".

Out of scope: opening router ports, self-signed certificates, plain `http://` in the release app (all rejected in `10` §8.2 and `12` §4), Tailscale Funnel (would put the server on the public internet), and public mode on a VPS (`10` §8.1, v1.1).

---

## 2. Where Things Stand (checked 2026-11-07)

### 2.1 Built

| Piece | State |
|---|---|
| Compose stack | Caddy published on `127.0.0.1:${MILEWAGE_HOST_PORT}` (default 8080); API publishes no port |
| `infra/install.sh` | Starts the stack, then **prints** `tailscale serve --bg <port>` as a next step |
| `infra/docs/install.md` §3 | Tailscale steps and the public-ledger privacy note, no screenshots |
| Pairing QR (`POST /pairing-tokens`) | `milewage://pair?v=1&u=<base>&t=<token>`; `<base>` is built from `X-Forwarded-Proto` + `X-Forwarded-Host` (or `Host`) of the web request |
| Phone app | Release build sets `usesCleartextTraffic=false` (https only); debug build allows http. Parser accepts http and https |

### 2.2 Never tested

No real tailnet has been used. Spike D (`12` §4, D1 to D6) has not run, and `spikes/D-results.md` does not exist. `progress.md` lists "a real tailnet and `tailscale serve`" as not verified.

### 2.3 Problems found

| # | Problem | Evidence | Effect |
|---|---|---|---|
| **P1** | **The QR says `http://` behind Tailscale.** Caddy replaces the `X-Forwarded-Proto: https` sent by `tailscale serve` with `http`, because it does not trust the sender | Tested 2026-11-07 with `caddy:2.8.4-alpine` (the stack's image): `https` in, `proto=http` at the upstream | The release app refuses the address. **Pairing through Tailscale cannot work today** |
| **P2** | **The QR uses whatever address the browser is on.** Opening the web app at `localhost` or a LAN IP gives a QR the phone cannot use, with no warning | Owner's attempt on 2026-11-07: LAN address, release app, "Cannot reach the server" | The most likely first-time mistake gives the vaguest error |
| **P3** | `08` §2.4 says the driver "can see and edit" the address before the QR is shown | Devices page shows the payload as text only | No way to correct a wrong guess |
| **P4** | The phone shows one message, "Cannot reach the server", for every failure: http refused, Tailscale off, DNS, certificate, timeout | `SettingsScreen.tsx` error map | The driver cannot tell which step to fix |
| **P5** | `10` §8.1 says Caddy should trust `127.0.0.1/32`. Caddy actually sees the **Docker gateway** of its network (`172.x.x.1`), not loopback | Same test: `X-Forwarded-For` arrived as `<client>, 172.17.0.1` | The planned setting would not fix P1. Partly answers Spike D's open question about the source address |
| **P6** | The dev server (Vite 7.3.7) answers `403 Blocked request. This host is not allowed` to `*.ts.net` | Tested 2026-11-07 | The owner cannot test the dev build from the phone through Tailscale |

P1 and P5 together mean the "Unverified" note in `install.md` §3 is now a known defect, not an open question.

---

## 3. Design

### 3.1 Caddy trusts the host's proxy (fixes P1, P5)

```caddy
{
	servers {
		trusted_proxies static <gateway of MILEWAGE_PROXY_SUBNET>/32
	}
}
```

Caddy then keeps `X-Forwarded-Proto`, `X-Forwarded-Host` and the real `X-Forwarded-For` that `tailscale serve` sends. Caddy is published on loopback only, so nothing outside the host can reach it to forge these headers. The gateway is `.1` of `MILEWAGE_PROXY_SUBNET` (default `172.29.88.1`), passed in through the compose environment. Tested on 2026-11-07 with `private_ranges`: `https` arrived intact. Owner choice: §10 Q5.

This also settles the `08` §7.4 / F9 client-IP caveat: per-IP limits see the tailnet address of the phone or browser.

### 3.2 One known server address (fixes P2, P3)

New server setting **`MILEWAGE_PUBLIC_URL`** (environment, for example `https://milewage-box.tail1234.ts.net`). It is deployment configuration, like `MILEWAGE_MODE`, not a module.

- `POST /pairing-tokens` puts `MILEWAGE_PUBLIC_URL` in the QR when it is set, and falls back to the forwarded headers when it is not (today's behaviour).
- `POST /pairing-tokens` accepts an optional `base_url` in the body: the driver's correction from the web (`08` §2.4). It must be an absolute `https://` URL without a path, query or credentials. `http://` is accepted only when the server runs in development (`NODE_ENV !== 'production'`), for debug builds.
- The response gains `base_url` (the address inside the QR) and `base_url_source: "configured" | "request" | "driver"`, so the web can explain where it came from.
- `install.sh` writes `MILEWAGE_PUBLIC_URL` into `.env` when it sets up Tailscale (§3.4).

### 3.3 Web: Devices page (fixes P2, P3)

Under the QR:

- **"Your phone will connect to"** followed by the address, with **Change address** (a text field, then **Make a new code**).
- A warning box, before the QR, when the address cannot work for the release app:
  - `http://`: "Phones only connect over https. Open MileWage at your Tailscale address (https://…ts.net) and pair from there." This links to the configured address when there is one.
  - `localhost`, `127.x` or a bare IP: "This address only works on this computer (or this network). Set up Tailscale first: see the install guide, section 3."
- The raw `milewage://` payload moves behind a **Show code text** disclosure (it is for typing the code by hand).

No new page or screen.

### 3.4 Install script: the Tailscale step (the main usability risk, `10` §18 item 5)

After the stack is healthy, `install.sh`:

1. Looks for the `tailscale` command. If it is missing, it prints the download link and the next steps, then stops. **It never installs Tailscale** (that needs root and the driver's own account).
2. Reads `tailscale status --json`. If the host is not signed in, it prints `sudo tailscale up` and stops.
3. Shows the **privacy note** and the machine name that will become public (`Self.DNSName`), then asks `Turn on https for <name>? [y/N]`. `--yes-tailscale` answers yes; `--no-tailscale` skips the step.
4. Runs `tailscale serve --bg <port>`. If Tailscale says HTTPS certificates are off for the tailnet, it prints the exact admin-console step (DNS → HTTPS Certificates) and stops.
5. Writes `MILEWAGE_PUBLIC_URL=https://<DNSName>` to `.env` and restarts the API so the setting takes effect.
6. Checks `https://<DNSName>/healthz` with retries for up to 90 s (the first certificate can be slow), then prints **"Open https://… in your browser, then Devices → Pair a phone."**

It never runs `tailscale funnel`.

### 3.5 Phone: check the address, then say what is wrong (fixes P4)

**Before redeeming** (no network call):

| QR address | Message |
|---|---|
| `http://…` in a release build | "This code uses an unsecured address (http). Open MileWage in your browser at its https address and make a new code." |
| `localhost` or `127.x` | "This code points at the computer that made it, not your server. Make the code from your server's https address." |

**When the request fails**, React Native's `fetch` gives one opaque error, so the cause is narrowed by what the phone can see:

| Condition | Message |
|---|---|
| Address ends in `.ts.net` and no VPN is active on the phone | "Tailscale is off on this phone. Open Tailscale, connect, then try again." Includes an **Open Tailscale** button. |
| Address ends in `.ts.net`, VPN active, no answer | "Your server is not answering through Tailscale. Check that the server is on and that the phone and server are signed in to the same Tailscale account." |
| Answer without the MileWage headers (`15` §9.4) | "That address answered, but it is not a MileWage server." |
| Anything else | Today's message, unchanged. |

VPN detection uses `expo-network` (`NetworkStateType.VPN`). It is **unverified** whether Android reports VPN while Wi-Fi is also on; this must be checked on the owner's phone. If it is not reported, the first two rows merge into one: "Can't reach your server. Is Tailscale connected on this phone?"

The **Open Tailscale** button opens the package `com.tailscale.ipn`, or the Play Store page when the app is not installed. That needs the `<queries>` manifest entry for the package (Android 11+).

**After pairing**, the sync banner's yellow "Offline. Saved on your phone." (`15` §9.4) gains the Tailscale hint only when the address is `.ts.net`, the phone has been unreachable for 10 minutes or more, and no VPN is active. Nothing else in sync changes.

### 3.6 Developer path (fixes P6)

- `apps/web/vite.config.ts`: `server.allowedHosts: ['.ts.net']` (dev server only, no effect on the build).
- `README` dev section: `npm run dev`, then `tailscale serve --bg 5173`, then open `https://<host>.ts.net` to pair the **release** app against the dev server. The Vite proxy passes the Tailscale `X-Forwarded-*` headers through unchanged, so the QR comes out as `https://`. Confirmed 2026-11-07: `tailscale serve` 1.104.5 sends `X-Forwarded-Proto: https` and `X-Forwarded-Host: <name>.ts.net`.
- Plain `http://` on the LAN stays available **only in debug builds**, as today.

### 3.7 Not packaged (documented only)

| Path | Status |
|---|---|
| Tailscale as a sidecar container (NAS without host Tailscale) | Documented alternative (`10` §8.2), not built |
| Cloudflare Tunnel to `127.0.0.1:8080` | Documented, not packaged (`10` §8.2). Set `MILEWAGE_PUBLIC_URL` to the tunnel address |
| WireGuard + public-CA certificate on an owned domain | Documented, not packaged |
| Plain `http://` in the release app | Rejected (`12` §4) |

---

## 4. Privacy and Security

- **Public machine name.** Turning on HTTPS publishes the machine and tailnet names on a public certificate log. The install script shows the exact name and asks before the step, and the guide says it before the step (S0 finding).
- **No Funnel.** The server stays reachable only inside the driver's tailnet.
- **Header trust.** Caddy trusts forwarded headers only from the Docker gateway, and Caddy is reachable only from the host's loopback. The API keeps trusting `X-Forwarded-For` only from the proxy subnet (`MILEWAGE_TRUST_PROXY`).
- **Tailscale identity headers** (`Tailscale-User-Login` and similar) are **not** used for sign-in. `08` keeps them as a possible later login behind `authenticate()`; not in this plan.
- **`base_url` from the driver** is only echoed into a QR the driver scans. It is never fetched by the server, so it is not a server-side request risk. It is validated as an https URL without credentials.

---

## 5. Modularity (README §1.3)

This is transport and deployment configuration, not a module, in the same way `MILEWAGE_MODE` is (`10` §8.1). There is nothing to switch off: without Tailscale the stack behaves exactly as today.

| Part | Seam | Removal |
|---|---|---|
| `MILEWAGE_PUBLIC_URL` | Core config, read by the devices routes | Unset: QR falls back to request headers |
| Caddy `trusted_proxies` | Caddyfile global block | Remove: headers are rewritten as today |
| Install Tailscale step | `install.sh` function, `--no-tailscale` | Skip flag |
| Phone hints | Pairing error mapper; `isTailnetAddress(url)` in one place | Delete the rows: falls back to today's message |

No new abstraction: Cloudflare Tunnel and others need only `MILEWAGE_PUBLIC_URL`, not a "tunnel provider" interface.

---

## 6. Tests

| Where | Test |
|---|---|
| Server | QR uses `MILEWAGE_PUBLIC_URL` when set; falls back to forwarded headers; `base_url` accepted only as https (http only outside production); response carries `base_url` and its source |
| Infra smoke (`infra/docker/smoke.sh`) | A request to the published port with `X-Forwarded-Proto: https` and `X-Forwarded-Host: x.ts.net` creates a QR starting `https://x.ts.net` **through Caddy**. This is the P1 regression test |
| `install.test.mjs` | Missing `tailscale` prints the link and exits 0; `--no-tailscale` skips; a fake `tailscale` on `PATH` returning a `DNSName` writes `MILEWAGE_PUBLIC_URL`; answering "no" writes nothing |
| Web | Warning for `http://`, `localhost` and an IP; **Change address** sends `base_url`; no warning for `https://*.ts.net` |
| Phone | Release-build http refusal before any request; localhost refusal; error mapping per §3.5 (VPN state injected); the 10-minute banner hint |
| Owner, on device (Spike D, `12` §4) | D1 to D6 with the release APK, plus **D7**: pair from the QR on Wi-Fi, then turn Wi-Fi off and confirm a sync on mobile data. Results go in `spikes/D-results.md` |

---

## 7. Build Order (PRs)

| ID | Title | Track | Tests | LOC | Dep |
|---|---|---|---|---|---|
| **T1** | Caddy `trusted_proxies` for the gateway + smoke regression for the https QR; fix `10` §8.1 and `install.md` §3 text (P1, P5). **Done 2026-11-07** (smoke check added with A1's public `GET /app`) | infra | smoke | 60 | — |
| **T2** | `MILEWAGE_PUBLIC_URL`; `base_url` in and out of `POST /pairing-tokens`; OpenAPI + generated types (P2, P3). **Done 2026-11-07**; the driver's `base_url` wins over the configured one (see `progress.md` T2) | server | server | 150 | — |
| **T3** | Devices page: address line, **Change address**, warnings, code-text disclosure (P2, P3) | web | web | 180 | T2 |
| **T4** | Phone: pre-redeem address checks, failure mapping, Open Tailscale, banner hint; `expo-network` and `<queries>` (P4) | phone | phone | 250 | — |
| **T5** | `install.sh` Tailscale step and flags; `install.test.mjs` | infra | install tests | 200 | T2 |
| **T6** | Dev path: Vite `allowedHosts` (**done 2026-11-07**), README dev section (P6) | web | manual | 20 | — |
| **T7** | Install guide rewrite with screenshots (host, admin console, phone app); Spike D + D7 run by the owner; `D-results.md` | infra + owner | owner run | 150 | T1–T5 |

T1 and T6 are small and **unblock owner testing straight away**: with them, `tailscale serve` in front of either the stack or the dev server gives a working https QR for the release app. T4 touches `apps/phone`, so it is sequenced with the phone track and is never edited in parallel with another phone PR (`17` §5).

This replaces the single row M10.1 in `17` with T1 to T7. M10.1's exit ("guide followed on a fresh VM by script") becomes T7's exit.

---

## 8. Owner Steps

1. Create or sign in to a Tailscale account (`infra-requirements.md` item 6: still PENDING).
2. Choose a machine name you are happy to have public (§4).
3. Install the Tailscale app on the phone and sign in to the same account.
4. After T1 and T6: test the release APK against `https://<host>.ts.net`.
5. After T1 to T5: run Spike D (D1 to D7) on the S24 Ultra and record the results.

---

## 9. Amendments to Other Documents (applied when T1 to T7 merge)

| Doc | Change |
|---|---|
| `10` §8.1 | `trusted_proxies static 127.0.0.1/32` → the Docker gateway of the proxy subnet (P5); remove "unverified" for the source address |
| `08` §2.4 | QR base: the driver's `base_url`, then `MILEWAGE_PUBLIC_URL`, then the forwarded headers (applied in T2); response fields `base_url`, `base_url_source` |
| `15` §9.4 | Unreachable state: the Tailscale hint rows of §3.5 |
| `17` | M10.1 replaced by T1 to T7 (§7) |
| `install.md` §3 | Rewritten around the install script; the "Unverified" paragraph removed |
| `infra-requirements.md` | Item 6 → DONE when the owner's tailnet exists |

---

## 10. Open Questions for the Owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | Should `install.sh` run `tailscale serve` itself after asking, or only print the command? | **Ask, then run it.** The fewer commands a driver types, the fewer go wrong |
| Q2 | Keep the driver-editable address on the Devices page (`08` §2.4 already promises it)? | **Yes**, behind **Change address**, because it is the only fix when the guess is wrong |
| Q3 | Allow plain `http://` on home Wi-Fi in the release app as an opt-in? | **No.** It fails on mobile data anyway and the plans reject it (`12` §4) |
| Q4 | Phone hint after pairing (§3.5, the 10-minute banner) | **Yes**, it is one line and only for `.ts.net` addresses |
| Q5 | Caddy trust: exactly the gateway address, or all private ranges? | **Gateway only**, the narrowest setting that works |
| Q6 | Order: T1 + T6 first so you can test now, then T2 to T5? | **Yes** |
