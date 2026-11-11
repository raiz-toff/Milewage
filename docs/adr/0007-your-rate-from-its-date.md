# Your mileage rate replaces the country's rate from its date, one rate per shift

Until 2026-11-10 a driver's own mileage rate had no date and applied only where the country pack had no rates (decision Q5 of 2026-11-07), so in Canada, the United States and Great Britain it could never be used. The owner decided that a driver may use their own rate instead of the pack's, for example an employer's reimbursement rate or a figure from their accountant, and that each own rate has an effective-from date so a change in the middle of a year is right. We decided that the rate valuing a shift is chosen by the shift's local date and nothing else: when the driver has chosen their own rate (`settings.use_own_mileage_rate`) and one of their rates is in force on that date (the latest effective-from on or before it), that rate values the whole shift, flat, per km or mile of business distance; otherwise the pack's rate does, as before; where the pack has no rates at all, the driver's rate applies without the switch (Q5 kept). A shift never mixes the two, and every figure that shows a deduction says which rate gave it (`deduction_rate` on a shift, `official`, `yours` or `mixed` on a period), with "your rate" never presented as official.

## Considered options

- **Own rates with tiers like the pack's** (a threshold per tax year): rejected then, added on 2026-11-11 by ADR 0012. Employer and accountant figures we know of are flat, and copying the pack's tier would claim a rule nobody gave us.
- **Own rate per vehicle kind**: rejected for now; the existing own rate applied to every automobile kind, and one list keeps the screen small. A per-kind rate can be added later as a column without changing the precedence rule.
- **Own rate only for the deduction method, not dated**: rejected; a mid-year change (the United States pack already has one, on 1 July 2026) would value half the year wrongly.

## Consequences

- The tier of a tiered pack rate (Canada's 5,000 km, Great Britain's 10,000 miles from 6 April) still counts every business metre of its rate period, whichever rate valued it. Because own rates run from their date onwards, shifts at the pack's rate always come before the first own rate in a period, so the tier of those shifts is unchanged.
- An own rate's date is a plain date, not a tax year: a driver who wants it to follow the Great Britain tax year chooses 6 April. The open decision on the GB year (AR4) is untouched.
- The rate an older own rate had becomes the undated row "from the start" (core migration 0014); `use_own_rate` starts off, so no deduction changes on upgrade.
- `GET /settings` keeps `own_mileage_rate` and `mileage_rate` as the rate in force today, which is what the phone's own estimate for unsent shifts reads; the phone still prefers the pack's rate where one exists, so its estimate for unsent shifts can differ from the server until the native app follows this rule.
- Bicycles, e-bikes, scooters and walking get no deduction at either rate, as before.
