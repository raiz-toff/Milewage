---
summary: The exports, the PDF report, what a mileage log holds, and what the tax figure is and is not.
group: using
order: 80
---

# For your accountant

This page explains what you can hand over, and what MileWage does and does not claim.

## The exports

Open the Exports page in the web app. Pick a period, then download:

- **Mileage and expenses report (PDF).** The one file to print or email. See [the PDF report](#the-pdf-report) below.
- **Mileage log (CSV).** One row per trip, or one row per shift. It opens in any spreadsheet. The shift file has the date, times, vehicle, platform, active, deadhead and total distance, the deduction value, which rate gave it (country rate or your rate) and your notes. It also has your odometer readings and a check against the GPS total. The active and deadhead columns are estimates, and a column says so.
- **Expenses (CSV).** Your expenses for the period, with the category and the deductible part.
- **Tax summary.** The numbers behind the year's tax estimate, with the working shown.
- **GPX and GeoJSON.** Your routes, for map programs and for anyone who wants to look at them on a map. They never contain money, labels or customer details.

## The PDF report

The Mileage and expenses report is one PDF for the period you pick. It is made on your server; nothing is sent anywhere.

- **The first page** names you (Settings > Profile and region > Name), the period, your vehicles, your country, when the file was made and the MileWage version. Then the notices: rates not yet checked, your rate is not an official rate if you used one, and not tax advice.
- **Summary**: your shifts, total, business and personal distance, the mileage deduction and which rate gave it, your expenses and the part you can deduct, and your earnings after app fees if the earnings module runs.
- **Mileage rates used**: each rate with the day it starts, marked country rate or your rate.
- **Expenses by category**, with what you spent and what you can deduct. Costs the mileage rate already covers show at zero.
- **Mileage log**: one row per ended shift with the date, start and end time, vehicle, platform, business and personal distance, odometer readings where you noted them, the deduction, your notes and anything an accountant should know, such as "distance estimated across a signal gap" or "added by hand".
- **Expenses**: one row per expense.

Long tables run onto more pages with their headings repeated, and every page is numbered. The paper is US Letter in Canada and the United States and A4 elsewhere; pick another next to the Download button. With a vehicle chosen, the report holds only that vehicle's shifts and expenses.

The figures are the same as in the CSV files and the Tax summary for the same period: money in your currency, times in your time zone, distance in your unit. Without a period it covers this calendar year. For a UK tax year, choose Custom, 6 April to 5 April.

No file is made for a particular accounting program. MileWage does not claim that any file imports into one.

## What a mileage log contains

A good log is written at the time of travel and shows, for each business trip: the date, where you went, why, and the distance. It also shows your total business distance for the year. MileWage records the date, times and distance from your GPS as you drive. You add the purpose and any notes.

What the tax offices ask for, as written in the project's plans:

- **IRS (United States).** A record kept at or near the time of travel with the date, destination, business purpose and distance of each use, and the total for the year. IRS Publication 463 does not require odometer readings. They are optional extra evidence.
- **CRA (Canada).** A logbook with the date, destination, purpose and distance of each trip, and the year's business and personal distance. The CRA asks for the odometer reading at the start and end of each tax year. MileWage has places for those readings.
- **HMRC (United Kingdom).** The journeys, their dates, the reasons, and the miles for each type of vehicle.

These lists come from the plans and have not been checked against the offices' own pages yet. The tax offices do not publish a required layout. So MileWage does not call any export "compliant", and nothing here promises that an audit will go well. Ask your accountant what they need.

## Rates are unverified

Every mileage rate and every tax figure in MileWage is unverified until the owner checks it against the tax office's own page. The Tax page (for Canada), the tax summary export and the PDF report say so in a notice. The dashboard, the shift pages and the phone show deductions without that notice, but they use the same unverified rates. Check any figure against the official source before you use it.

You can use your own rate instead, from a day you choose, in Settings > Mileage rate (see [Your mileage rate](mileage-rates-and-tax.md#your-mileage-rate)). Every file and screen labels a deduction at it as your rate, never an official one. Ask your accountant whether your rate is one you may claim.

## The tax figure is an estimate

The tax page gives an estimate to bring to an accountant. It is not a tax return, and nothing is filed. In this version only Canada has a tax estimate. The United States and Great Britain have mileage rates but no tax estimate.
