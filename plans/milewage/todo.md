# To-do (owner list)

Small items noticed while testing. Each becomes its own PR when picked up. Newest first.

## Open

- [ ] **Time zone picker with every time zone** (owner, 2026-11-07). Setup and Settings show a
      plain text field ("America/Toronto"). Make it a searchable list of all IANA time zones
      (`Intl.supportedValuesOf('timeZone')`, the standard list browsers and Node ship), shadcn
      Combobox style, default to the browser's zone
      (`Intl.DateTimeFormat().resolvedOptions().timeZone`), the zones of the chosen country first,
      and the current UTC offset shown next to each name. Server keeps validating the name.
- [ ] Vehicles page shows a bare error code ("not_found") when the tax-year request fails without
      a message; show a plain sentence instead (found in X3).
- [ ] Time fields (Schedule) show 12h/24h by the browser's language, not by Settings › Time
      format (W5b).
- [ ] Badge colour picker for platforms; the API already accepts a colour (PL4b).
- [ ] Shifts list cannot show platform badges: the shifts API has no platforms per shift (PL2).
- [ ] Web `formatMoney` still assumes two decimal digits; use the currency's own digits (J9).
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
- [ ] Error `type` URIs use `https://milewage.dev/errors/…`, a domain the owner does not own
      (`apps/server/src/errors.ts`, plan 08).
- [ ] Choose a licence for MileWage before taking outside contributions (plan 21 §2.4).

## Owner to confirm

Decisions builders made and wrote as "Assumption (owner to confirm)" in `progress.md`. The main
ones: existing vehicles count as owned; "earnings" means after app fees; the own mileage rate has
no dates; Nova Scotia HST 14 % vs 15 %; the dashboard opens on Week.
