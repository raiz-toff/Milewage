# 24 — Phone first run: connect to your server, then get ready to drive

**Status: plan, 2026-11-07.** Owner request: the phone is useless without a server, so it must not
open on the home screen. It walks the driver through "is your server set up?", connecting, and the
permissions, and makes the connection smooth. Builds on plan 19 (connection over Tailscale), plan 23
(web onboarding) and plan 09 (background GPS and the permission ladder).

## 1. Goal

From installing the app to "ready for the first shift" with no dead ends:

1. A driver without a server learns what to do and where, then comes back.
2. A driver with a server connects in one scan.
3. If the connection fails, the phone says which step is wrong (plan 19 §3.5).
4. The phone asks only for the permissions recording needs, one at a time, each explained.
5. The home screen appears only when the phone is connected.

## 2. What exists today (P1 stack and plan 19)

- `navigation.tsx` starts on **Home** whether paired or not. Pairing lives in Settings: QR scanner
  (`pairing/QrScanner.tsx`, `expo-camera`), `milewage://pair` links (`pairing/PairingLinks.tsx`),
  and typed codes.
- `PermissionsScreen` and `permissions/ladder.ts`: the permission ladder with warnings (plan 09).
- Home has a "Finish setting up" checklist (`screens/SetupChecklist.tsx`).
- Plan 19 (draft, T1–T7 not built) designs: the server's public `https://…ts.net` address in the
  QR, phone checks before connecting, failure messages ("Tailscale is off on this phone" with
  **Open Tailscale**), and the install script's Tailscale step.
- Web (plan 23): the wizard's last steps show the pairing QR and wait for the phone.

## 3. Standards and practice checked (web search, 2026-11-07)

| Source | What we take |
|---|---|
| Home Assistant companion app ([getting started](https://companion.home-assistant.io/docs/getting_started/)) | Find or enter the server, sign in, then optional permissions, then the dashboard. Their local discovery (mDNS) is **not** used: MileWage's release app accepts only `https` over Tailscale (plan 19), and a LAN address would not work away from home. |
| Immich ([setup guide](https://docs.vultr.com/how-to-deploy-immich-an-opensource-alternative-to-google-photos)) and Nextcloud ([QR login](https://help.nextcloud.com/t/cannot-find-qrcode-for-setting-up-mobile-clients/48202)) | Check the server works in a browser first; a QR carrying the address and a token saves typing. MileWage already does this (`milewage://pair?v=1&u=…&t=…`). |
| Android [background location](https://developer.android.com/develop/sensors-and-location/location/permissions/background) and [Android 11 location](https://developer.android.com/about/versions/11/privacy/location) | Ask for location while in use first; ask for "Allow all the time" separately, after an explanation screen, by sending the driver to the settings page (Android 11+ has no such button in the dialog); a driver who declines can still use the app. |
| [dontkillmyapp.com](https://dontkillmyapp.com/samsung) | Per-maker steps to stop the phone killing the app (Samsung: Never sleeping apps / battery unrestricted). Plan 09 already rules out requesting the battery exemption permission; we show the steps and open the settings page. |
| QR scanning libraries ([vision-camera vs expo-camera](https://scanbot.io/blog/react-native-vision-camera-vs-expo-camera/)) | `expo-camera`, `react-native-vision-camera` and the Google code scanner all use Google ML Kit or Play services on Android. A scanner without Google needs a ZXing-based decoder (see Q1). |

## 4. Design

### 4.1 Gate

At start the app reads whether it is paired:

- **Not paired** → the first-run screens below. Home, Shifts and Settings are not reachable.
- **Paired** → Home, as today.
- **Unpaired by the server** (token revoked) → back to the first-run screens with "This phone was
  disconnected from your server. Connect again."

### 4.2 Screens (one thing per screen, back always works)

| # | Screen | What it says and does |
|---|---|---|
| 1 | **Welcome** | "MileWage records your shifts and sends them to your own MileWage server." Two buttons: **I have a server** / **I don't have one yet**. |
| 2 | **Set up your server** (only from "I don't have one yet") | Four short steps on a computer: install MileWage (install guide), turn on Tailscale, open MileWage in the browser and create your account, finish setup and press **Pair a phone**. Buttons: **Send these steps to my computer** (Android share sheet with the guide link), **Open the guide**, then **My server is ready**. |
| 3 | **Get Tailscale on this phone** (only when needed) | Shown before connecting when the app can tell Tailscale is missing or off (plan 19 §3.5): **Install Tailscale** / **Open Tailscale**, "Sign in with the same account as your server". Skippable: the driver may use another https route (plan 19 §3.7). |
| 4 | **Connect** | **Scan the code** (camera), with two other ways below: **Open the link** (when the web page is open on this phone, the `milewage://` link pairs directly) and **Paste the code**. Address checks before connecting and plain failure messages, from plan 19 §3.5, live here. |
| 5 | **Connected** | "Connected to <address> as <name>." Shows what the server sent: country, region, vehicles. If the server has no vehicle yet: "Finish setup on the web: add your vehicle" with **Check again**, because a shift needs a vehicle. |
| 6 | **Notifications** (Android 13+) | "See your shift's time and distance in the notification bar." Allow / Not now. |
| 7 | **Location while using** | "MileWage records your route while a shift runs." System dialog. |
| 8 | **Location all the time** | Explanation, then **Open settings** for "Allow all the time"; what happens without it (plan 09 warning wording). Not now is allowed. |
| 9 | **Keep MileWage running** | The maker's steps (Samsung first, others from dontkillmyapp.com), **Open battery settings**. Not now is allowed. |
| 10 | **Ready** | "You're ready. Start your first shift." → Home. |

Rules:

1. Screens 6–9 reuse `permissions/ladder.ts`; the ladder decides which are needed and in which
   order; a granted one is skipped.
2. Anything skipped stays on the Home checklist (existing), so nothing is lost.
3. Settings keeps **Connect to a different server** and **Permissions**.
4. The phone's design system (P1), plain language, no Comma web styling.

### 4.3 The web side of the same moment

- Plan 23's "Pair your phone" step adds **Get the app** (where the APK or store listing lives: Q2)
  next to the QR, and says "Open MileWage on your phone and tap Scan the code".
- When the web is opened on the phone itself, the step shows **Open in the MileWage app** (the
  `milewage://` link), the same as screen 4's second way.

### 4.4 Server

Nothing new for the phone flow: pairing (`POST /pairing-tokens`, redeem) and settings exist.
Plan 19's `MILEWAGE_PUBLIC_URL` and checks (T1–T5) make the QR address right; they stay in plan 19.

### 4.5 Phone and web must show the same numbers (from a phone review, 2026-11-07)

- The phone computes the Home deduction itself (`store/summary.ts`). Country rules move in J4
  (done). The phone's settings cache has no `region` and no custom rate (J8), and it does not know a
  vehicle uses actual expenses (server value `null`, `18` §7). **J9** (added to plan 21 track J):
  region and custom rate reach the phone; the phone shows the server's figure for synced shifts and
  computes only unsynced ones; the currency fallback formatter uses the currency's own digits.
- Keep heavy libraries out of `packages/shared`: the phone bundles it.

## 5. PRs

Stacked on the integration branch X1 (plan 23 §5), in parallel with the web O1–O4 (different files).
Each at most 400 lines with tests, `npm run verify` green, `progress.md` entry, pushed, not merged.
The owner tests on the phone; no emulators.

| PR | Branch | Content |
|---|---|---|
| PO1 | `pr-PO1-phone-first-run-gate` | Gate (paired / not / revoked), Welcome, Set up your server (share sheet, guide link). |
| PO2 | `pr-PO2-phone-connect` | Connect screen (scan, link, paste) moved out of Settings; plan 19 §3.5 checks and messages; Tailscale screen (`expo-network`, `<queries>` for `com.tailscale.ipn`). Takes over plan 19 T4. |
| PO3 | `pr-PO3-phone-connected-permissions` | Connected screen (server summary, "add your vehicle on the web"), notifications, location, all the time, battery steps through the ladder; Ready. |
| PO4 | `pr-PO4-web-get-the-app` | Web pairing step: Get the app, "Open in the MileWage app" on a phone. |

## 6. Open decisions for the owner

- **Q1 QR scanner and Google.** `expo-camera` scans with Google ML Kit, which brings Google's usage
  logging (open since P1). Options: (a) keep it; (b) replace it with a ZXing-based scanner without
  Google (zxing-cpp is Apache-2.0; needs a small native module or a maintained wrapper, to be
  checked on the phone); (c) no in-app scanner: the phone's own camera reads the QR, and the QR
  opens an `https://<server>/pair?...` page with **Open in the MileWage app**. Recommendation: (b),
  with (c) as the fallback that also helps phones where the in-app scanner fails.
- **Q2 Where drivers get the app.** An APK served by the driver's own server (the web's "Get the
  app" downloads it), a public download page, F-Droid or Play Store. Recommendation for now: the
  server serves the APK it was built with, so phone and server versions match.

## 7. Not in this plan (phone backlog from the review)

- Local shift and sync reminders from the `shift_reminders` and `sync_reminder` settings.
- Schedule and goals on the phone (goal ring, planned-shift reminders).
- A notifications inbox on the phone.
- Splitting the P1 phone stack further where a PR is over 400 lines (P1a–P1g exist; sizes to be
  checked before merge).
