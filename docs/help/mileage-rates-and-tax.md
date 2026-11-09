---
summary: Country packs and regions, how the mileage deduction is worked out, what the Tax page estimates, and why every figure is unverified.
group: using
order: 70
module: tax
---

# Mileage rates and tax

MileWage turns your distance into a mileage deduction and, in Canada, estimates what to set aside for tax. Both are estimates for your accountant. Nothing is filed.

## Every figure is unverified

Every mileage rate and tax figure in MileWage is unverified: no person has compared it with the tax office's own publication yet.

In Canada the Tax page says so in its note, and the Tax summary export carries a notice. Shift pages and the dashboard show deduction values without that note. Check any figure with the CRA, the IRS or HMRC before you use it.

## Country and region

Choose them in Settings > Profile and region: Canada, the United States or the United Kingdom. Each has a country pack of rates and regions.

In Canada the province sets the sales tax name (GST or HST), and for Quebec the estimate leaves out the pension contribution, because Quebec has its own plan. Until you set a province, only the national rules apply.

## How the mileage deduction is worked out

Each ended shift gets a deduction: its total distance times the pack's rate for the shift's date and vehicle type. These rates and thresholds are unverified.

- **Canada**: per km for cars, vans and motorcycles, with a higher rate for the first 5,000 km of the calendar year. It is the provinces' rate; the territories' higher rate is not used.
- **United States**: one rate per mile for cars, vans and motorcycles, taken at the shift's date.
- **United Kingdom**: per mile, with a higher rate for the first 10,000 miles of the tax year from 6 April for cars and vans, and one rate for motorcycles.

Bicycles, e-bikes, scooters and walking get none. A threshold counts all your vehicles of the same type together.

The deduction uses the shift's total distance. A trip you marked personal is still part of that total, and the dashboard shows the figure next to your business distance. Ask your accountant how to treat personal driving.

A rate is dated. When a new year begins before its rate is in MileWage, shifts in that year show no deduction. Update the server when a release adds the rate; see [upgrading](../../infra/docs/upgrade.md).

## Your mileage rate

Your mileage rate is for a country with no rates in MileWage. It never replaces a country's rate, and a deduction at it is labelled "your rate". All three countries you can pick have rates, so in this version its box in Settings > Profile and region does not appear.

## How a vehicle is deducted

On the Vehicles page, each vehicle has a deduction picker for the current year:

- **Mileage rate**: the shifts get a mileage deduction. Costs the rate covers, such as fuel and insurance, are saved but not deducted.
- **Actual expenses**: the shifts get no mileage deduction, and those costs count.

Never both. The choice is saved per calendar year. See [Expenses and receipts](expenses-and-receipts.md#costs-the-mileage-rate-already-covers).

## What the Tax page estimates

The Tax page works on a calendar year.

**In Canada** it shows what to set aside and the next date. Details > How this is worked out shows the working:

1. Earnings after app fees, minus the expenses you can deduct, minus the mileage deduction, which is not money paid to you.
2. Taxable income, never below zero.
3. The self-employed pension contribution in two bands, and income tax at your set-aside rate.
4. Set aside in total, and a quarter of it for each instalment.

The income tax line is a planning figure, not tax brackets. The set-aside rate starts at 25 percent; change it in Details > Tax settings. Deadlines lists the instalment, balance and filing dates, and notes a platform above the T4A amount. These are unverified too.

"No earnings are entered or labelled for this year" means there is nothing to estimate from. Enter earnings on your shifts; see [Earnings and platforms](earnings-and-platforms.md).

**In the United States and the United Kingdom** there is no tax estimate, only the tax jar. The mileage deduction still shows on shifts.

## Sales tax in Canada

Tick "Registered for GST" (or HST) in Tax settings and type the sales tax you collected. Owing is that amount minus credits. The amount is not saved. Credits stay at zero, because the expense form has no box for sales tax paid. Nova Scotia's HST rate is an assumption the owner still has to confirm; no figure on the page uses it today.

## Tax year

Canada and the United States count the calendar year. The United Kingdom's starts on 6 April, which MileWage uses only for the 10,000-mile threshold. Expense totals, the deduction choice and the Tax page count calendar years. For a UK year, use a Custom period from 6 April to 5 April on the Exports page.

## The tax jar

The tax jar is your own record of money you put away for tax; no money moves. In Canada the jar's target is your earnings times your set-aside rate, which is not the same as Set aside in total.

## What to hand your accountant

The Tax summary on the Exports page has the year's working, each vehicle's method and mileage deduction, the jar and the deadlines. Outside Canada it holds only notices, so hand over the mileage log and the expenses file. See [For your accountant](for-your-accountant.md).
