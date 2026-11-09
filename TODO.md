# To-do (owner list)

Small items noticed while testing. Each becomes its own PR when picked up. Newest first.

## Open

- [ ] **Try the sending module on the phone** (AR5, 2026-11-09). (1) Add a trip on the phone's
      shift detail: it must reach the web (before, every phone-added trip was parked). (2) End a
      shift with the server reachable: the home screen sends it within the round. (3) Offline: "Offline.
      Saved on your phone." then sent when back. (4) After a server restore, the banner and the
      resend of older shifts. (5) "Deduction so far" with a personal trip is lower than without.
- [ ] **Great Britain tax year** (AR4, 2026-11-09). Only the mileage rate tier follows 6 April; the
      deduction method, double-counted expenses, the tax report, exports, analytics set-aside, goals
      and the odometer year check use the calendar year. Decide whether GB figures should follow the
      6 April year everywhere (then the Tax page, exports and `expense-math.ts` change together).
- [ ] **Run `milewage-cli recalc` once after upgrading** if shifts were ever created by CSV import
      (AR4): earlier imports left `calculated_at` empty, so their trips never reached the phone.
- [ ] **Try the re-pairing fixes on the phone** (AR3, 2026-11-09). (1) Revoke the phone on the web,
      pair again with a new QR code: every queued shift (create and end, not only points) should be
      sent within a minute. (2) The same with a link code on the home Wi-Fi. (3) Scan the QR with the
      camera app, open the page, "Open in the MileWage app": Settings should show both addresses.
      (4) After the "different MileWage server" banner, re-pair to the new server: sending should
      resume without a restart.
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
- [ ] Badge colour picker for platforms; the API already accepts a colour (PL4b).
- [ ] Shifts list cannot show platform badges: the shifts API has no platforms per shift (PL2).
- [ ] Edit and delete a hand-made trip on the web (W2i).
- [ ] When the app is on Google Play: set `MILEWAGE_APP_STORE_URL` and replace the plain "Get it
      on Google Play" button with Google's official badge file (A2).
- [ ] A public install-guide URL for the phone's "Set up your server" screen (currently hidden;
      PO1/X2).
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
- C1 releases: tags are `v<VERSION>`; GitHub Actions builds the images on the tag; the APK is built
  by hand, and `MILEWAGE_VERSION_CODE` must be raised for every build uploaded (v0.1.0 is 1);
  Renovate groups Expo and React Native minors with everything else.
- N1 phone: the unsynced-data reminder has no on/off switch yet (plan 15 section 13 names one).
