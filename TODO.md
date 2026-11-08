# To-do (owner list)

Small items noticed while testing. Each becomes its own PR when picked up. Newest first.

## Open

- [ ] **Tag `v0.1.0`, or decide to wait for the field test** (owner, 2026-11-08). CHANGELOG and
      VERSION say 0.1.0, but `git tag` lists nothing. To tag:
      `git tag -a v0.1.0 -m "MileWage 0.1.0" && git push origin v0.1.0`. A tag starts nothing yet:
      the release jobs left with GitLab; see the next item.
- [x] **Rewrite history to drop the dev data folder, or leave it** (owner, 2026-11-08). Done
      2026-11-08: rewritten before the first GitHub push; origin force-pushed to match. `cada039`
      committed `.dev.before-integrate-2026-11-08/` (dev databases, encrypted backups,
      `config/secrets.json`). Z1 takes it out of the index, but every commit from `cada039` on
      still holds it. Origin is a private git server on the LAN. A rewrite changes the hash of every
      commit since `cada039` (32 on 2026-11-08) and needs a force push.
- [ ] **Release workflow on GitHub Actions** (owner, 2026-11-08). The GitLab `images` and
      `phone-apk` jobs were removed with GitLab. Decide the registry (GitHub Container Registry,
      `ghcr.io/raiz-toff/milewage`, is the natural one) and how the upload keystore reaches the
      runner (an encrypted Actions secret holding `keystore.env` and the keystore file). Then the
      workflow builds the server and Caddy images for amd64 and arm64 on a `v*` tag and the APK on
      request, as the GitLab jobs did.
- [ ] **Make Node 22.22 the default on `coder`** (owner, 2026-11-08). `node --version` is v24.15.0;
      `.nvmrc` says 22.22.0. Verify runs use Node 22 only because `~/.local/node22/bin` is put first
      on `PATH`; a shell without it runs Node 24. Install 22.22 as the default (nvm is not
      installed), or put `~/.local/node22/bin` first on `PATH` in the shell profile.
- [ ] **Run spikes A, B and D, or record that the field test replaces them** (owner, 2026-11-08).
      Only S0 has run; E is optional. Status table in
      plan 12 section 2, "Spike status (2026-11-08)".
- [ ] **Time zone picker with every time zone** (owner, 2026-11-07). Setup and Settings show a
      plain text field ("America/Toronto"). Make it a searchable list of all IANA time zones
      (`Intl.supportedValuesOf('timeZone')`, the standard list browsers and Node ship), shadcn
      Combobox style, default to the browser's zone
      (`Intl.DateTimeFormat().resolvedOptions().timeZone`), the zones of the chosen country first,
      and the current UTC offset shown next to each name. Server keeps validating the name.
- [x] (F1) Vehicles page shows a bare error code ("not_found") when the tax-year request fails without
      a message; show a plain sentence instead (found in X3).
- [x] (F1) Time fields (Schedule) show 12h/24h by the browser's language, not by Settings › Time
      format (W5b).
- [ ] Badge colour picker for platforms; the API already accepts a colour (PL4b).
- [ ] Shifts list cannot show platform badges: the shifts API has no platforms per shift (PL2).
- [x] Web money display and typing use the currency's own minor-unit places (F1; stored values are minor units)
- [ ] Edit and delete a hand-made trip on the web (W2i).
- [x] Plan 19 T1–T3: Caddy trusted proxies (T1), `MILEWAGE_PUBLIC_URL` (T2), Change address and
      the Tailscale warning on the web (T3). Done 2026-11-07, `pr-T1`…`pr-T3`.
- [x] Get the app in setup: public download page `/app`, wizard step with its QR, store link
      setting, `--publish` for the latest build (owner, 2026-11-07). Done, `pr-A1`…`pr-A3`.
- [x] Plan 19 T5: the install script's Tailscale step (writes `MILEWAGE_PUBLIC_URL`). Done
      2026-11-07, `pr-T5-install-tailscale`; not yet run on a real fresh host (T7).
- [ ] When the app is on Google Play: set `MILEWAGE_APP_STORE_URL` and replace the plain "Get it
      on Google Play" button with Google's official badge file (A2).
- [ ] A public install-guide URL for the phone's "Set up your server" screen (currently hidden;
      PO1/X2).
- [x] Error `type` URIs are relative (`/api/v1/errors/<code>`) and resolve on every instance (F1)
      (`apps/server/src/errors.ts`, plan 08).
- [x] Choose a licence for MileWage before taking outside contributions (plan 21 §2.4). Done
      2026-11-08: AGPL-3.0-only, `LICENSE` at the root, `license` in every package.json (pr-Z11).
      Usual options for self-hosted apps: AGPL-3.0 (used by Immich and Nextcloud; keeps hosted forks
      open), or Apache-2.0 or MIT (allow wider reuse). The choice must come before any outside
      contribution. No LICENSE file is added until it is made.

- [ ] **OS notifications on the phone need a backend** (N1, 2026-11-08). `expo-notifications` was
      installed, inspected and removed: it always brings Firebase Cloud Messaging and Google's
      datatransport logging, which the Q1 decision (plan 24 section 6) ruled out for the camera. The
      port, the unsynced-data reminder logic and the tests are in place; nothing fires on a device
      until the owner picks: (a) accept Firebase, (b) a small local Expo module on
      `NotificationManagerCompat` plus an inexact `AlarmManager` alarm (recommended, same route as
      the ZXing scanner), or (c) exclude Firebase in Gradle (unsupported by Expo).

## Owner to confirm

Decisions builders made and wrote as "Assumption (owner to confirm)" in `progress.md`. The main
ones: existing vehicles count as owned; "earnings" means after app fees; the own mileage rate has
no dates; Nova Scotia HST 14 % vs 15 %; the dashboard opens on Week.

Added 2026-11-08 by the integration pass (details in `progress.md` under each PR):

- R1 `milewage-cli restore`: the old data is parked at `<data>/before-restore-<time>/` inside the
  `data` volume (not beside it), kept until the owner deletes it; no extra `pre-restore/` backup is
  written; `diagnostics.db` is left in place.
- F1 money: every stored amount is read as integer minor units of `settings.currency`, so a stored
  JPY `1250` shows as ¥1,250 (the old display divided by 100 regardless of currency). Schedule's
  time field offers 5-minute steps.
- S1 privacy page: `/privacy` on the owner's own address is the Google Play privacy-policy URL and
  names no developer contact; HSTS is one year without `includeSubDomains`; the page suggests
  `tailscale serve reset`, which clears every serve setting on that machine.
- C1 releases: tags are `v<VERSION>`; in CI the Android versionCode is the pipeline IID, so hand-made
  APKs need a higher `MILEWAGE_VERSION_CODE`; the `images` job needs a privileged runner; Renovate
  groups Expo and React Native minors with everything else.
- N1 phone: the unsynced-data reminder has no on/off switch yet (plan 15 section 13 names one).
