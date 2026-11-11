# The mileage deduction uses the business distance, not the shift total

A shift's total distance includes trips the driver marked personal, and until 2026-11-09 the server fed that total into the country pack's deduction, although the pack's input is defined as business metres and the dashboard already showed "business distance" as the total minus personal trips. The mileage deduction module now takes the business distance (`total_m - personal_m`) for every figure, including the distance that fills a rate tier. Total miles still never depend on stops (decision 1.5b): the active and deadhead split plays no part, only the personal kind does. Nothing stored changes, because the deduction is computed on read, so every view corrects at once.

## Consequences

- A shift with a personal trip deducts less than the same shift without one; a test guards this.
- The phone's own estimate for shifts not yet sent still used the total when this was written; it follows the same rule.
- The GB tax year (6 April) is not part of this decision: only the rate tier follows 6 April; the deduction method, double-counted expenses, the tax report, exports, goals and the odometer year check use the calendar year. The owner decides whether to change that.
