# 23 — Onboarding: the first-run setup on the web

**Status: plan, 2026-11-07.** Built on plan 21 (country structure) and its tracks J, L, V. The
owner asked for the onboarding Comma had (where the driver works, which apps, which vehicle), built
on the new country structure.

## 1. Goal

A new driver goes from "account created" to "first shift recorded" with as few questions as
possible, and every answer changes something real: the rules used, the apps listed, the vehicle's
rate. Nothing is asked that the data already answers.

**Activation (the moment the product proves itself):** the first finished shift shows its distance
and deduction value on the dashboard. Everything in onboarding serves that: the country and region
pick the rules, the vehicle gets the rate, the phone records the shift.

## 2. What exists today

- `Setup.tsx`: one form, owner account plus country, unit, currency, time zone (API `POST /setup`
  needs all of them). Then `RecoveryKey.tsx`. Then the dashboard.
- Dashboard "Finish setting up" card (`DashboardExtras.tsx`, `SetupChecklist`): other apps, vehicle,
  weekly goal, pair phone, backup; computed from server state; hidden when done.
- Phone: pairing (QR) and the permission ladder; its own setup checklist (P1).
- Not asked anywhere at setup: region, apps, vehicle details, goal. Comma asked "Which apps do you
  drive for?", "What do you drive?" (with whether the vehicle gets the mileage rate) and "What's your
  weekly target?" on the phone.

## 3. Standards and practice checked (web search, 2026-11-07)

| Source | What we take |
|---|---|
| GOV.UK Design System, [question pages](https://design-system.service.gov.uk/patterns/question-pages) and [one thing per page](https://designnotes.blog.gov.uk/2015/07/03/one-thing-per-page/) | One question per step; ask only what is needed. |
| GOV.UK [check answers](https://design-system.service.gov.uk/patterns/check-answers) | A last step that lists every answer with a "Change" link. |
| NN/g wizard definition and wizard patterns ([Visa](https://design.visa.com/patterns/wizard/usage/), [PatternFly](https://v4-archive.patternfly.org/v4/design-guidelines/usage-and-behavior/wizard), [Microsoft](https://learn.microsoft.com/en-ie/Windows/Win32/uxguide/win-wizards)) | Show where the driver is and how many steps remain; completed steps can be edited; a wizard is heavy, so keep it short and skip what does not apply. |
| W3C WAI [multi-page forms](https://w3.org/WAI/tutorials/forms/multi-page/) | "Step 2 of 5" in the main heading and the page `<title>`; optional steps easy to spot and skip; no time limits. |
| Onboarding practice (time to value, checklist pattern, no dead ends, dismissable) | Short wizard for what changes the numbers; the existing checklist keeps the rest; every step skippable except where the rules need an answer. |
| Gig apps (Gridwise, Solo, Stride, Comma) | They ask which apps the driver works for and the vehicle; no public detail of their flows was found. |

Not used: email sequences (self-hosted, no mail server) and funnel analytics (no third-party
telemetry; plan 16). Progress is computed from the driver's own data.

## 4. Design

### 4.1 Where it runs

On the **web**, right after the recovery key is confirmed, before the dashboard. The phone stays a
data collector: it keeps pairing and the permission ladder and shows no onboarding of its own
(owner, 2026-11-07: the phone is a data collector). Pairing the phone is a step of the web wizard
(the QR is shown there).

### 4.2 Steps (one thing per step)

| # | Step | Shown when | Saves to | Skippable |
|---|---|---|---|---|
| 1 | **Where you drive**: region (province, state …) with the country's level label | the country has regions | `settings.region` | Yes. Skipping keeps national rules; the dashboard keeps prompting (owner decision Q4, plan 21). |
| 2 | **What work you do**: delivery, ride-hailing, motorcycle taxi, courier | the country offers more than one work kind (plan 21 §3.6a) | `settings.work_kinds` | Yes |
| 3 | **Your apps**: the country's and region's apps as checkboxes, plus "Another app" | module `platforms` is on | `PUT /platforms/{slug}` (active, custom) | Yes |
| 4 | **Your vehicle**: name, kind, ownership (Track V); a line saying which rate applies ("Gets the CRA allowance rate", "No official rate here: you can set your own rate" from J8, "Bicycles have no mileage rate") | always | `POST /vehicles` (and `PATCH /settings` for a custom rate) | No: a shift needs a vehicle. "Skip" only if one already exists. |
| 5 | **Weekly goal** | module `goals` is on | `POST /goals` | Yes |
| 6 | **Pair your phone**: the pairing QR and link, waits for the phone, says "Paired" | module `devices` is on | `POST /devices/pairing-tokens` (existing) | Yes ("Pair later") |
| 7 | **Check your answers**: every answer with "Change"; "Finish" | always | `settings.onboarded_at` | — |

Rules:

1. **A step with only one possible answer is not shown.** The answer is set from the data (for
   example work kind "delivery" while CA, US and GB list only that). Steps come from data, not from
   country checks in code (plan 21 §3.4 rule 1).
2. Steps are a list in one file: `id`, `visible(ctx)`, `done(ctx)`, the component. A new step (for
   example worker status when a country has more than one) is one entry.
3. Back and forward keep answers; the driver can leave and come back: done-ness is read from server
   state, as the checklist does.
4. Heading and title: "Your vehicle — Step 3 of 5". The count is of the visible steps.
5. Each step saves when the driver presses Continue, so nothing is lost if the browser closes.
6. Plain language, the web's shadcn components and tokens, works at phone width.

### 4.3 Server

- `settings.onboarded_at` (nullable epoch ms) and `settings.work_kinds` (list) in the `Settings`
  response and `PATCH /settings`; a core migration. Existing owners with a vehicle are marked as
  onboarded by the migration so they do not see the wizard. **Assumption (owner to confirm).**
- Nothing else new: every step uses an existing endpoint, `GET /countries` (J5), and the vehicle
  and platform routes.

### 4.4 After the wizard

- The dashboard checklist stays for anything skipped, with "Continue setup" opening the wizard at
  the first unfinished step.
- Settings has "Run setup again".
- The region prompt (Q4) stays on the dashboard while the country has regional rules and no region
  is set.

### 4.5 Account creation

`Setup.tsx` keeps the owner account and the fields `POST /setup` requires (country, unit, currency,
time zone) with country names from `GET /countries` (J5) and unit and currency defaulted from the
country. Splitting account creation into one-question pages is not part of this plan: it would
change `POST /setup`.

## 5. PRs

Stacked on an integration branch that merges the finished tracks (J8, L4, V3 and this plan) so the
wizard builds on all of them. Each PR at most 400 lines with tests, `npm run verify` green, a
`progress.md` entry, pushed, not merged.

| PR | Branch | Content |
|---|---|---|
| X1 | `pr-X1-tracks-merged` | Merge J8, L4, V3 and O0; resolve OpenAPI, tax report and progress conflicts; regenerate types; verify. No new features. |
| O1 | `pr-O1-onboarding-server` | `onboarded_at`, `work_kinds`, migration, OpenAPI, tests. |
| O2 | `pr-O2-onboarding-shell` | Wizard shell: step list, visibility and done rules, progress heading and title, back, skip, resume, routing after the recovery key; region and work steps. |
| O3 | `pr-O3-onboarding-apps-vehicle` | Apps and vehicle steps (ownership, rate line, custom rate). |
| O4 | `pr-O4-onboarding-goal-phone-finish` | Goal, pair phone, check answers, finish; checklist "Continue setup"; Settings "Run setup again". |

## 6. Not in this plan

- Phone onboarding beyond pairing and permissions.
- Splitting account creation (`POST /setup`) into one-question pages.
- Worker status and tax regime steps: they appear by rule 1 when a country offers more than one.
- Translations (plan 21 Q7d, later).
