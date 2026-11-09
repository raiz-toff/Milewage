---
summary: Entering what each platform paid for a shift, fees, cash and payouts, your own platforms, and how per hour is worked out.
group: using
order: 60
module: earnings
---

# Earnings and platforms

Earnings are what the platforms paid you after their app fees. You enter them on each shift, per platform, after the shift ends. MileWage does not connect to your platform accounts.

## Where the figures come from

A shift's earnings for a platform come from one of two places:

- **A total you type** on the shift's Earnings card. The card marks it "entered by you".
- **Stop labels**, when stop detection is on. The Fare and Tip on a shift's stop labels add up per platform, marked "from stop labels". On a stop label, Fare is the pay for that order.

A total you type replaces that platform's stop labels for the shift. The labels stay on the shift page. The owner can make the two add up instead, with `MILEWAGE_EARNINGS_OVERRIDE`; see [tax and country options](../../infra/docs/configuration.md#6-tax-and-country-options).

Only ended shifts count. "Enter earnings after the shift has ended" means the shift is still running. End it on the phone, then enter its earnings.

## Typing a shift's total

Open the shift and find the Earnings card. Pick the platform, type Base pay, Gratuities and Bonus, and Orders if you want them. Choose Save total.

It is one figure per platform for the whole shift. Saving again for the same platform sets those three amounts to what you typed this time. An empty box counts as zero.

Remove, next to a platform, deletes everything entered for that platform on that shift, its lines included.

## Lines for fees, cash and payouts

Choose "Add a cash order, fee or payout line". Pick the platform and the kind, type the amount without a sign, and choose Add line. A line cannot be edited. To fix one, remove it and add it again.

| Kind                     | What it is                                | In your earnings  |
| ------------------------ | ----------------------------------------- | ----------------- |
| Fare, Tip, Bonus         | Pay for orders                            | Adds              |
| Commission, Platform fee | What the platform takes                   | Takes off         |
| Correction to pay        | A fix to pay; you pick the direction      | Adds or takes off |
| Cash collected           | Cash a customer handed you                | Not counted       |
| Tax withheld             | Tax the platform kept back                | Not counted       |
| Top-up                   | Money you paid into the platform's wallet | Not counted       |
| Payout                   | Money the platform sent to your bank      | Not counted       |

A cash order is two lines: a Fare and the same amount as Cash collected. The fare counts as earnings; the cash line says the money is already in your hand.

## The balance with the app

Once a platform has such lines, the card shows its fees, tax withheld, cash collected and balance. The balance is every line added up. Pay and top-ups raise it. Fees, tax withheld, cash collected and payouts lower it. A correction moves it either way.

For example, a cash order of 20.00 with a 4.00 commission: Fare 20.00, Cash collected 20.00, Commission 4.00. Your earnings are 16.00. The card says "You owe the app 4.00", because the app's cut has to come out of cash you already hold. A Payout line for what the platform sends you brings a positive balance back to zero.

The balance is kept per shift and platform. There is no running balance across shifts in this version. A weekly payout or a top-up that belongs to no single shift goes on a shift of that week.

## Your platforms

Your platforms are in Settings > Platforms. The list starts with the platforms offered in your country and region.

- **Switch one off** to drop it from the pickers. Its past labels and earnings stay.
- **Add your own**: type its name, up to 40 characters, and choose Add. The name needs letters or digits.
- **Add a logo** from the row menu: PNG, JPEG or WebP, up to 256 KB. It stays on your server and in its backups.

There is no colour choice on the web. A platform you add gets a colour picked from its name and a badge with its initials.

Built-in platforms cannot be renamed or deleted. Delete, for a platform you added, works only while nothing uses it. "Labels or earnings use this platform" means it is in use. Switch it off instead.

## Earned, per hour and per mile

The dashboard's "Earned, after app fees" is your fares, tips, bonuses and corrections, minus commission and platform fees, for the ended shifts in the period. Tax withheld, cash collected, top-ups and payouts are not in it. With nothing entered or labelled it says "Not entered", not zero.

Per hour is those earnings divided by shift time: from the start to the end of each shift, breaks included. Analytics shows the same figure as "Per hour (shift time)". Its "Per hour (online time)" needs your online time in each app, which the web has no box for, so it shows no figure.

When you type orders, Analytics also shows the pay per order and orders per hour. The web shows no earnings per mile or per km in this version.

## In the exports

The mileage log, one row per shift, has the platform, fares, tips and bonus of each shift. In Canada the Tax summary lists earnings by platform and the fees taken. See [For your accountant](for-your-accountant.md).
