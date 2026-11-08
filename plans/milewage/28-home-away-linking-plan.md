# 28 — Home and away addresses, and linking a phone found on the Wi-Fi

**Status: plan, 2026-11-08.** Owner report: "if its in the same network then it shouldnt be asking
for tailscale" and "the link process needs to be smoother". Builds on plan 19 (connection over
Tailscale) and plan 24 (phone first run). Amends plan 19 section 1 (plain http on the home network
was out of scope) and its Q3 (answered "no" then, "yes, only to private addresses" now).

## 1. Owner decisions (2026-11-08)

1. **Plain http on the home network is allowed.** The phone may use `http://` **only** to a
   private or home address: IPv4 `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, link-local
   `169.254.0.0/16`, IPv6 unique local `fc00::/7` (the owner named `fd00::/8`, the half that is
   actually handed out) and link-local `fe80::/10`, and the names `*.local`, `*.lan` and
   `*.home.arpa`. Everything else is `https://` (Tailscale or public). Like Home Assistant's
   internal URL.
2. **Linking = auto-find + confirm.** On the home Wi-Fi the phone finds the MileWage server by
   itself (mDNS / DNS-SD), the driver taps it and confirms a short code. The QR stays as the
   fallback.

## 2. What is wrong today

| # | Problem | Where |
|---|---|---|
| H-P1 | The release app is built with `usesCleartextTraffic=false` and refuses every `http://` code, so at home it can only use the Tailscale address and keeps asking for Tailscale | `app.json`, `connect/reach.ts` |
| H-P2 | The phone stores **one** address. There is no "home" address to fall back to when Tailscale is off, and no "away" address when the code was made on the LAN | `pairing.ts` `Credential.baseUrl` |
| H-P3 | First run shows **Get Tailscale on this phone** before Connect whenever Tailscale is missing or off, even at home | `firstrun/TailscaleScreen.tsx` (PO2d) |
| H-P4 | The Docker stack publishes Caddy on `127.0.0.1` only, so nothing on the LAN can reach it | `infra/docker/docker-compose.yml` |
| H-P5 | The session cookie is always `Secure`. Browsers drop a `Secure` cookie set by an `http://` page (except `localhost`), so signing in at `http://192.168.x.x:8080` silently fails in the Docker stack. The dev server hides this by stripping `Secure` in the Vite proxy | `auth/sessions.ts`, `apps/web/vite.config.ts` |
| H-P6 | The web warns "Phones only connect over https… set up Tailscale" for any `http://` or IP address, including a perfectly good home address | `apps/web/src/pairing/address.tsx` |
| H-P7 | Linking needs the camera pointed at a screen, or copy-paste; there is no way for the phone to find the server | — |

## 3. Research (checked 2026-11-08)

### 3.1 How other self-hosted apps pick a home or an away address

| App | How it chooses | Cost |
|---|---|---|
| Home Assistant companion ([networking](https://companion.home-assistant.io/docs/troubleshooting/networking/)) | Internal URL (example `http://homeassistant.local:8123`) when the phone is on a listed home Wi-Fi **SSID**, external URL elsewhere | Needs location **"Allow all the time"** on Android, because Android gives the SSID only to apps with location |
| Immich ([v1.122 release](https://linuxiac.com/immich-1-122-brings-hdr-video-support-in-the-mobile-app/), [discussion #19696](https://github.com/immich-app/immich/discussions/19696), [issue #21930](https://github.com/immich-app/immich/issues/21930), [issue #15220](https://github.com/immich-app/immich/issues/15220)) | "Automatic URL switching": local URL on the preferred Wi-Fi (SSID), otherwise the external URLs **in order, the first one that answers** | Same location permission; reported bugs with several SSIDs and the wrong URL at start |
| Plex ([forum: connections](https://forums.plex.tv/t/what-kinds-of-connections-are-defined-can-be-made/172522)) | The client gets a list of the server's local and remote addresses and uses the one that works ("Nearby", "Remote", "Indirect") | No permission; reachability decides |
| Jellyfin ([Quick Connect](https://jellyfin.org/docs/general/server/quick-connect/); discovery on UDP 7359, [forum](https://forum.jellyfin.org/t-jellyfin-auto-discovery-on-docker-bridge-network?pid=70542)) | One address per server entry; local discovery by UDP broadcast, which does not cross a Docker bridge | — |

**Choice: reachability probing, no SSID.** MileWage already asks for location, but "all the time"
is optional (plan 24 rule: every step may be skipped), so an SSID rule would break exactly for the
drivers who said no. Probing needs no permission and also covers a wired tablet, a second access
point with another name, and a changed SSID. It is what Immich does for its external list and what
Plex does. To keep it fast and safe:

- The home address is tried only when the active network is Wi-Fi or Ethernet (also under a VPN:
  Android gives a VPN network the transports of the network under it, PO2c). On mobile data only
  the away address is used.
- The probe is `GET <home>/healthz` with a **1.5 s** timeout and must answer with the
  `X-MileWage-Instance` this phone linked to (`15` section 9.4). A café Wi-Fi with something else
  at `192.168.1.20:8080` fails the probe, so the device token is never sent to it.
- The choice is remembered for 60 s and forgotten at once when a request fails with no answer, so
  walking out of the house switches at the next upload.

### 3.2 Finding the server on the Wi-Fi

- **DNS-SD over mDNS** ([RFC 6762](https://www.rfc-editor.org/rfc/rfc6762),
  [RFC 6763](https://www.rfc-editor.org/rfc/rfc6763)) is the standard: the server announces
  `MileWage._milewage._tcp.local` with SRV (host, port) and TXT records; the phone browses for
  `_milewage._tcp`. Service names are at most 15 characters, letters, digits and hyphens
  ([RFC 6335 section 5.1](https://www.rfc-editor.org/rfc/rfc6335#section-5.1)); `milewage` fits.
  Not registered with IANA (fine for a private type; registration is free and can come later).
- **Phone:** Android's [`NsdManager`](https://developer.android.com/reference/android/net/nsd/NsdManager)
  (`discoverServices`, then `resolveService`, one at a time before Android 14). It runs in the
  system, so no `CHANGE_WIFI_MULTICAST_STATE` or multicast lock is needed.
- **Server library:** [`@homebridge/ciao`](https://github.com/homebridge/ciao) 1.3.12, the last release out longer than two weeks (MIT,
  RFC 6762/6763 compliant: probing, conflict renaming, announcements, goodbye packets on stop;
  four small dependencies). Alternative `bonjour-service` (MIT, built on `multicast-dns`) does less
  of the RFC's probing and conflict handling.
- **Docker:** multicast does not cross Docker's bridge network; Home Assistant's container install
  uses `network_mode: host` for discovery ([HA install, Docker Compose](https://www.home-assistant.io/installation/linux#docker-compose),
  [community](https://community.home-assistant.io/t/docker-network-mode-host/332446)). MileWage's
  API stays on the bridge; a **separate small advertiser** container from the same server image
  runs with `network_mode: host`, only when LAN access is turned on (section 4.6). Documented
  alternative for hosts that already run Avahi: a static service file
  ([`avahi.service(5)`](https://linux.die.net/man/5/avahi.service)) in `/etc/avahi/services/`.

### 3.3 Android: local network permission and cleartext

- [Local network permission](https://developer.android.com/privacy-and-security/local-network-permission):
  enforced only for apps **targeting Android 17 (API 37)**; MileWage targets 36 (React Native
  0.88's `targetSdk`), where "local network access is implicitly granted using the INTERNET
  permission", and Google says **not** to declare or request `ACCESS_LOCAL_NETWORK` before
  targeting 37. `NEARBY_WIFI_DEVICES` was only Android 16's opt-in test switch (deprecated). Nothing
  to request now. When the app moves to target 37: `NsdManager`'s system picker
  (`DiscoveryRequest.FLAG_SHOW_PICKER`) grants access to the one chosen server without the broad
  permission, and that grant persists. Recorded as a to-do for the target-37 upgrade.
- **Cleartext:** [Network security configuration](https://developer.android.com/privacy-and-security/security-config)
  can allow cleartext per domain name but not per IP range, so the private-address rule cannot be
  written there. Home Assistant's app allows cleartext for everything in its
  [`network_security_config.xml`](https://github.com/home-assistant/android/blob/main/app/src/main/res/xml/network_security_config.xml)
  ("We need to allow clear traffic for those who don't have SSL setup") and leaves the choice to the
  user. MileWage does the same at the platform level (`usesCleartextTraffic=true`) but is
  **stricter in code**: every request goes through `ApiClient`, which refuses `http://` to any host
  that is not a home address (section 4.2), with unit tests. The app makes no other plain requests
  (map tiles and the store link are https).

### 3.4 The confirm code: who shows it, who types it

| Pattern | Who shows | Who confirms | Weakness |
|---|---|---|---|
| OAuth device authorization ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628) sections 3.3, 5.1, 5.4) | The new device shows a short `user_code` | The user **types** it in a signed-in browser; the device polls with a long secret `device_code` | Remote phishing (section 5.4): mitigated by showing what is asking and confirming it is in your hand |
| Jellyfin [Quick Connect](https://jellyfin.org/docs/general/server/quick-connect/) | The new device shows a 6-character code | A signed-in client types it and confirms | Same |
| Bluetooth numeric comparison | Both show the same 6 digits | The user taps "they match" | Users tend to accept without comparing; a second request at the same moment is approved by a careless tap |
| A code shown on the web, typed on the phone | The signed-in web | The phone sends it | The short code is a secret on the network: anyone on the Wi-Fi can guess it within its life unless the limit is tight |

**Choice: the RFC 8628 / Quick Connect shape.** The phone shows a 6-digit code; the web lists the
waiting phone by name ("Galaxy S24 wants to link") with a field for the code. Why:

- the short code is accepted **only from a signed-in web session**, so nobody on the Wi-Fi can
  guess it; the phone holds the long secret (`device_code`) and polls with it;
- typing the code picks the right phone, so a second "Galaxy S24" sent by someone else at the same
  moment cannot be approved by mistake (numeric comparison's weak spot);
- it is exactly the owner's picture of the web saying "Phone X wants to link — code …", with the
  code typed rather than only looked at. **Assumption (owner to confirm)**: typing six digits on
  the computer, instead of one Approve button.

## 4. Design

### 4.1 One rule for "home address" (shared)

`packages/shared/src/home-address.ts`, used by server, web and phone:

- `isHomeHost(host)`: the ranges and names of decision 1 (IPv4 by numbers, IPv6 by prefix, names
  case-insensitive; `localhost` and loopback are **not** home: they are "this computer").
- `isHomeAddress(url)`: an `http(s)://` URL whose host is a home host.
- `httpAllowed(url)`: `https://` always; `http://` only when `isHomeAddress(url)`.

Tailscale's `100.64.0.0/10` is not a home range: Tailscale addresses go through `https://…ts.net`.

### 4.2 Two addresses per phone

| | Home address | Away address |
|---|---|---|
| What | The server on the LAN, e.g. `http://192.168.1.20:8080` | `https://<host>.<tailnet>.ts.net` or another https address |
| Scheme | http or https | https only |
| Server sources, in order | `MILEWAGE_HOME_URL`; else the address the web is open at, when it is a home address | the driver's correction; `MILEWAGE_PUBLIC_URL`; else the address the web is open at, when it is https and not a home address |
| Phone sources | what the phone found on the Wi-Fi; the code's `h`; the redeem answer's `home_url` | the code's `u` (when not a home address); the redeem answer's `away_url` |

- `POST /pairing-tokens` answers `home_url` and `away_url` (each may be null) next to today's
  `base_url` and `base_url_source` (kept: `base_url` = away, else home).
- **QR stays `v=1`**: `u` = the away address when there is one, else the home address (an old app
  still reads `u` as before); a new optional `h=<home address>` is added when there is a home
  address different from `u`. The phone's parser already ignores unknown parameters. The `/pair#`
  form gets the same `h`.
- `POST /pairing/redeem` (and the link answer, 4.4) also return `home_url` and `away_url`, so a
  phone linked at home learns the Tailscale address and the other way round.
- The phone's `Credential` keeps `baseUrl` (the address it linked through; old phones have only
  this) and gains `homeUrl` and `awayUrl`. A phone from before this change reads as
  `awayUrl = baseUrl` or `homeUrl = baseUrl` by `isHomeAddress`.

### 4.3 How the phone picks (section 3.1)

```
only one address        -> that one
not on Wi-Fi/Ethernet   -> away
probe home (1.5 s) ok and same instance -> home
otherwise               -> away
```

Remembered for 60 s, forgotten when a request gets no answer. Each request asks for the current
choice, so uploads, settings and the change feed all follow it. Tailscale is mentioned **only when
the away address was chosen and failed** (the PO2c/PO2d messages and the Home notice): at home the
phone never asks for Tailscale. A phone with only a home address that is away says "Can't reach
your server. You are away from your home Wi-Fi; shifts are kept on this phone and sent when you are
back." and offers "Set up Tailscale to send from anywhere" as optional.

### 4.4 Linking with a code (section 3.4)

Server, module `devices`, no new table (requests live in memory for 10 minutes; a restart drops
them, the phone then says "Try again"):

| Route | Who | What |
|---|---|---|
| `POST /link-requests` | phone, no sign-in | `{device_name, platform}` → `201 {device_code: "mwl_…" (32 random bytes), user_code: "482913", expires_in: 600, interval: 2}`. At most 5 waiting requests per client address and 20 in all; the user code is unique among waiting requests |
| `POST /link-requests/poll` | phone | `{device_code}` → `202 {status:"pending"}`; after approval `201` with the redeem body (`device_id`, `device_token`, `settings`, `home_url`, `away_url`) **once**; `410 link_expired` after expiry, denial or use. Polled faster than `interval`: `429` with `Retry-After` (RFC 8628 `slow_down`) |
| `GET /link-requests` | web (session) | waiting phones: `id`, `device_name`, `platform`, `from` (client address), `created_at`, `expires_at`. Never the codes |
| `POST /link-requests/approve` | web (session, Origin checked) | `{user_code}` → `200 {device_name}`; wrong code `422 invalid_link_code`, at most 10 wrong codes per 15 minutes per user (`FailureLimiter`) |
| `DELETE /link-requests/{id}` | web (session) | "Not my phone": the phone's next poll gets `410` |

Approval makes an ordinary pairing token for the user and stores its hash in the request; the
poll redeems it with the existing `repo.redeem`, so a linked phone is the same row as a scanned one.

### 4.5 Phone: Connect screen

1. **Welcome → I have a server → Connect.** The **Get Tailscale on this phone** screen no longer
   comes before Connect (H-P3); Tailscale is offered only when an away address fails.
2. Connect starts browsing for `_milewage._tcp` at once: **"On this Wi-Fi"**, a list of servers
   found (name and address, e.g. "MileWage · 192.168.1.20"), "Looking…" while browsing, and
   "None found on this Wi-Fi" after 6 s with **Look again**. Not on Wi-Fi: "Connect to your home
   Wi-Fi to find your server, or scan the code."
3. Tap a server → **Link this phone** screen: "On your computer, open MileWage, then Devices (or
   the setup step Pair your phone) and type this code:" **482 913**, the server's address, a
   spinner "Waiting for your computer…", **Cancel**. On approval: the Connected screen (PO3a) as
   today. Expired: "The code expired." with **Get a new code**.
4. Below the list: **Scan the code** (QR, unchanged), and **Paste the code** behind "Other ways".

### 4.6 Server on the LAN

- **Dev (`npm run dev`)**: the advertiser runs inside `scripts/dev.mjs` and announces the Vite
  port; `MILEWAGE_HOME_URL` is set to `http://<first private IPv4>:<vite port>`. Turned off with
  `MILEWAGE_LAN_DISCOVERY=0`.
- **Docker**: a new opt-in setting, **LAN access** (`install.sh --lan`, or by hand in `.env`):
  `MILEWAGE_BIND_ADDRESS=0.0.0.0` publishes Caddy on the LAN, `MILEWAGE_HOME_URL=http://<host
  LAN IP>:<port>`, and `COMPOSE_PROFILES=lan` starts the `lan-discovery` service (same server
  image, `network_mode: host`, `node dist/advertise.mjs`). The advertiser announces only while
  `http://127.0.0.1:<port>/healthz` answers, and puts the instance id from that answer in TXT.
  Without `--lan` nothing changes: loopback only, no advertiser.
- TXT record: `v=1`, `id=<instance id>`, `path=/`. The phone uses the resolved IPv4 address and
  port (Android does not resolve `.local` names for ordinary requests on every version).

### 4.7 Web

- **Session cookie** (H-P5): `Secure` when the sign-in request is https (the browser's `Origin`
  scheme, or `X-Forwarded-Proto` from the trusted proxy); without it on a plain http page. The Vite
  proxy's strip workaround goes.
- **Devices page and the wizard's Pair your phone step**: first **Link a phone on your Wi-Fi**:
  "Open MileWage on your phone. It finds this server; tap it, then type the code the phone shows."
  Waiting phones appear as they arrive (checked every 3 s while the page is open): "**Galaxy S24**
  wants to link (from 192.168.1.42) · [code field] **Link** · Not my phone". Then **Or scan a
  code** with today's QR.
- **Addresses, said plainly** under the QR: "**At home:** http://192.168.1.20:8080 — used when the
  phone is on your Wi-Fi." / "**Away:** https://box.tail1234.ts.net — used everywhere else
  (Tailscale)." / "Away: not set up. Shifts are sent when the phone is back on your Wi-Fi. To send
  from anywhere, set up Tailscale (install guide, section 3)."
- **Warnings** (H-P6): an `http://` or IP address that is a home address is **not** a problem any
  more; the warnings stay for `localhost`/`127.x` (this computer only) and for `http://` to a
  non-home host ("Phones use http only on your home network").

## 5. Security notes for http on the LAN

- **What travels in clear on the Wi-Fi**: the device token (bearer) and everything the phone
  uploads (routes, earnings), and the web session cookie when the web is used at the http address.
  Anyone who can watch the home Wi-Fi traffic (or a compromised device on it) can read them and act
  as the phone. That is the trade the owner accepted (Home Assistant's internal URL makes the same).
  WPA2/WPA3 protects the radio link from outsiders; it does not protect from other devices on the
  same network. The web says so in one line next to the home address.
- **Never to the wrong server**: http is refused in code for anything but home addresses; the home
  address is used only after the probe sees this phone's instance id; on mobile data it is never
  tried.
- **Link codes**: the short code is accepted only from a signed-in session, limited to 10 wrong
  tries per 15 minutes; the `device_code` is 256 random bits, single use, 10 minutes. On a watched
  LAN someone who reads the `device_code` could poll first and take the link: the real phone then
  sees "already used" and the web lists two phones, one of them unexpected; the driver revokes it.
- **LAN access in Docker** publishes Caddy on all interfaces. Docker's port publishing bypasses
  host firewalls such as ufw ([Docker docs, packet filtering](https://docs.docker.com/engine/network/packet-filtering-firewalls/)):
  the install guide says so. Caddy keeps trusting forwarded headers only from the bridge gateway;
  with Docker's normal iptables publishing a LAN client keeps its own address and cannot forge
  `X-Forwarded-Proto`. **Rootless Docker** (userland proxy) makes every client look like the
  gateway: LAN access is not supported there and the guide says so.
- **mDNS** announces that a MileWage server exists at that address to everything on the LAN. Off
  unless LAN access is on; the TXT holds no names or account data.
- **Session cookie without `Secure` on http**: the cookie then also goes over http, which is the
  point; `HttpOnly` and `SameSite=Strict` stay.

## 6. PRs (each at most about 400 lines with tests)

| PR | Branch | Content |
|---|---|---|
| H0 | `pr-H0-home-away-plan` | This plan; plan 19 Q3 and plan 24 notes |
| H1 | `pr-H1-home-away-server` | Shared `home-address.ts`; `MILEWAGE_HOME_URL`; `home_url` / `away_url` in pairing codes (QR `h`) and in the redeem answer; OpenAPI |
| H2 | `pr-H2-cookie-http-lan` | Session cookie `Secure` only on https; Vite proxy workaround removed |
| H3 | `pr-H3-link-requests` | Server: link requests with a code (section 4.4); OpenAPI |
| H4 | `pr-H4-lan-discovery-server` | Advertiser (`@homebridge/ciao`), `advertise.mjs`, dev script |
| H4b | `pr-H4b-lan-docker` | Compose `lan` profile and bind address, `MILEWAGE_HOME_URL` in compose, `install.sh --lan`, install guide |
| H5 | `pr-H5-web-link-a-phone` | Web: Link a phone on your Wi-Fi, home and away lines, warnings |
| H6 | `pr-H6-phone-home-away` | Phone: http only to home addresses (cleartext on, code gate), home/away credential, the picker with probe, `h` in codes, transport in `net-check` |
| H7 | `pr-H7-phone-discovery` | Phone: `NsdManager` browsing in `net-check`, Connect "On this Wi-Fi", Link this phone screen with polling; Tailscale screen out of the first-run path |
| H8 | `pr-H8-phone-away-hints` | Phone: Settings shows both addresses; Tailscale hints only when away fails; a home address that moved (new DHCP address) is picked up from discovery when the instance id matches |

Order: H1–H5 server and web, then the phone H6–H8, then a release APK for the owner.

## 7. Tests

| Where | What |
|---|---|
| Shared | Every range and name of decision 1, the edges (`172.15/172.32`, `fe80`, `fd`, `.local.` with a dot), loopback and public refused, malformed URLs |
| Server | Home and away from config and request, `h` in the QR, redeem answer; link requests: create, limits, poll pending/approved/expired/used, `slow_down`, approve with wrong and right code, the wrong-code limit, deny, not visible without a session; cookie with and without `Secure`; advertiser TXT and on/off |
| Web | Waiting phone with the code field, approve, wrong code message, Not my phone; home and away lines; no warning for a home http address, warning for public http and localhost |
| Phone | `ApiClient` refuses http to a public host; the picker (one address, mobile data, probe ok, probe wrong instance, timeout, 60 s memory, failure forgets); codes with `h`; Connect lists found servers; Link this phone shows the code, polls, connects; expired; no Tailscale screen before Connect |
| Owner on the phone | At home: Connect finds the server, link with the code, a shift uploads with Tailscale off. Leave home with Tailscale on: the next upload goes through Tailscale. Leave home with Tailscale off: the Tailscale hint appears |

## 8. Remaining questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Type the code on the web (chosen) or a one-tap Approve with both screens showing the code? | Type it (section 3.4) |
| Q2 | Should the install script turn LAN access on by default? | **Ask** during install, default yes on a home server, no with `--no-lan` |
| Q3 | Prove the server's identity before sending the token to a home address (an HMAC of a nonce with the device token's hash), against a targeted fake server on another Wi-Fi with the same private address? | Later; the instance check covers the accidental case |
| Q4 | Target SDK 37 (Android 17): switch discovery to the system picker | When the app moves to 37 |
| Q5 | Register `_milewage._tcp` with IANA | Optional, free; later |
