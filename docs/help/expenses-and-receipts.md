---
summary: Adding an expense, categories and the deductible share, receipts, and repeating expenses.
group: using
order: 50
module: expenses
---

# Expenses and receipts

An expense is money you spent for work. MileWage keeps the amount, a category and how much of it counts for work. The deductible figures are estimates to bring to an accountant, not tax advice.

## Adding an expense

Open Expenses and choose Add expense, or use Add expense on the dashboard.

1. Type the amount. The date starts as today.
2. Pick a category. The five you use most are offered first. More… holds the rest, in two groups: Vehicle, and Work and other.
3. Choose Save expense.

More details opens the rest: merchant, deductible share, vehicle, shift, repeats and notes. The shift list offers shifts within 7 days of the expense's date.

To change an expense, open its row menu and choose Edit. Delete removes the expense and its receipt.

Parking and tolls added on a shift's page are expenses linked to that shift; see [Parking and tolls](shifts-and-trips.md#parking-and-tolls).

## Categories and the deductible share

Each category starts with a deductible share. Under More details you can switch Deductible off, or pick 25, 50, 75 or 100 percent business use. The deductible amount is the amount times that share, rounded to the cent.

Most categories start as deductible in full. These start differently:

| Category                          | Starts as               |
| --------------------------------- | ----------------------- |
| Phone, Data plan, Meals           | 50 percent business use |
| Finance or hire-purchase payments | Not deductible          |
| Out of pocket (not deductible)    | Not deductible          |

These are starting points, not tax office rules. Your accountant can say what share fits.

Parking and Tolls start as deductible in full, and the mileage rate never covers them, so they count next to it. No country pack in MileWage says otherwise yet, and no person has checked this against the tax offices' pages.

## Costs the mileage rate already covers

A mileage rate is meant to pay for running the vehicle. Five categories would be counted twice next to it: Fuel, Maintenance and repairs, Insurance, Vehicle rental, and Finance or hire-purchase payments.

Put one of them on a car, van or motorcycle whose deduction for that year is Mileage rate, and MileWage saves it but does not deduct it. In the list, the Deductible column reads "covered by the mileage rate". The year is the calendar year of the expense's date. Costs of bicycles, e-bikes, scooters and walking count either way.

To deduct these costs instead, set the vehicle's deduction for the year to Actual expenses on the Vehicles page. That vehicle then gets no mileage deduction for that year. See [Mileage rates and tax](mileage-rates-and-tax.md#how-a-vehicle-is-deducted).

## Receipts

Each expense can hold one receipt, a photo or a PDF. In the list, use the Receipt column to pick a file. View receipt opens it. Remove receipt, in the row menu, deletes it. To change a receipt, remove it and attach the new one.

- The file can be JPEG, PNG, WebP or PDF, up to 10 MB.
- All receipts together can take up to 2 GB.
- Before a JPEG, PNG or WebP photo is stored, the server removes the location the camera wrote into it. PDF files are kept as they are.
- Receipts stay on your server and go into every backup. A restore brings them back.
- Receipts are added on the web only. The phone app does not take them.

"A receipt can be 10 MB at most" means the file is too big. Save a smaller copy of the photo or PDF and attach that.

"The receipt store is full" means all receipts together have reached 2 GB. Keep a copy of old receipts elsewhere, then remove them here.

If there is no Receipt column, receipts are switched off on your server. The owner turns them on in `settings.json`; see [server modules](../../infra/docs/configuration.md#5-modules).

## Repeating expenses

For a cost you pay on a schedule, open More details and set Repeats to Weekly, Monthly or Yearly. Next due starts as the expense's date.

A repeating expense is a reminder, not an expense. It is not in All expenses and is not counted. Setting Repeats on a saved expense turns it into a reminder too, so it leaves the list and the totals. When its date comes, it shows under Due now on the Expenses page.

- Add it records an expense with the same details on the due date. The next due date moves on by a week, a month or a year.
- Remind me in a week hides it for seven days.

The first due date is the day you set, so choose Add it once to record the first payment.

In this version there is no list of repeating expenses, and you cannot change or stop one on the web. If you no longer pay a cost, do not add it when it comes up; choose Remind me in a week instead.

## Where expenses show up

- The top of the Expenses page shows the deductible amount and the total spent for the calendar year. Costs the mileage rate covers are left out of the deductible figure.
- In Canada, the Tax page takes the deductible expenses off your earnings in its working, under "Expenses you can deduct". See [Mileage rates and tax](mileage-rates-and-tax.md).
- On the Exports page, Expenses gives a CSV for the period, with the share, the deductible amount and whether the mileage rate covers each cost. It says whether a receipt is attached but does not contain the files.

See [For your accountant](for-your-accountant.md) for what to hand over.
