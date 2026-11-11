# Your mileage rate may have a second step

ADR 0007 gave a driver their own dated mileage rate and rejected tiers for it: the figures we knew of were flat, and copying the country's tier would claim a rule nobody gave us. On 2026-11-11 the owner asked for it: rules of the kind "this rate for the first so much, then that rate" exist outside the three country packs, and a driver whose employer, accountant or country works that way could not enter it. We decided that each own rate may carry one optional step: a threshold in whole km or miles and the rate after it (`threshold_units`, `cents_per_unit_after`; both or neither). The first rate values business distance up to the threshold, the second the rest. The count is the same one a tiered country rate uses: every business metre of the same vehicle kind driven since the start of the rate period, in date order, whichever rate valued it; a shift that crosses the threshold is split. The rate period is the country's (calendar year, 6 April in Great Britain) and the calendar year where the country has no rates. A rate without a step is flat, exactly as before.

## Considered options

- **More than two steps, or a free table of bands**: rejected. Every rule we have seen has one threshold; a second column pair can be added later.
- **A period chosen per rate** (the driver picks when the count restarts): rejected for now; it adds a field almost nobody needs, and the country's period is right for the driver's own tax year.
- **Counting only distance valued at the own rate**: rejected; the country rate already counts every business metre, and two counts for one year would give two answers to "how far have I driven".

## Consequences

- A driver must type the rule themselves; MileWage does not suggest the country's figures as an own rate and still calls it "your rate", never official.
- An own rate that starts in the middle of a rate period finds part of its threshold already used by the distance driven before it.
- `GET /settings` `own_mileage_rate` carries the step with the start of the rate period and the business distance the server has counted in it by vehicle kind (`step`), so the phone's estimate for unsent shifts splits at the threshold too: the server's count, then the phone's unsent shifts, then the shift itself. The count is as old as the phone's last read of the settings; the server's figure replaces the estimate once the shift is sent.
- The PDF report's rate table shows the second rate and its threshold under the first.
