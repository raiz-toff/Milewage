# Components

Two layers. shadcn/ui gives the controls; the repo's own primitives give pages and screens their
shape. Compose from the primitives; reach for raw shadcn only inside a primitive or when none fits,
and then consider adding a primitive instead of repeating markup.

## Web: shadcn/ui installed

`alert badge breadcrumb button calendar card checkbox dialog dropdown-menu input label popover
radio-group select separator sheet sidebar skeleton switch table tabs tooltip` in
`apps/web/src/components/ui/`. Add another with the shadcn CLI, never by hand, and leave these
files unedited (coverage excludes them for the same reason). Imports use the `@/` alias.

## Web: layout (`apps/web/src/ui/layout.tsx`)

| Primitive   | Use it for                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `PageHeader`| The top of every page: title, one line of context, the page's actions on the right.                    |
| `Section`   | A titled card. `label` makes it a named region for tests and screen readers; `bare` for a section inside another card. |
| `StatCard`  | One figure with its label and an optional line under it. Dashboards and the tops of pages.             |
| `EmptyState`| What a list says when it has nothing in it: what it is and what to do next.                            |
| `TableBox` + `tableClass` | The bordered, scrollable box around a plain `<table>`; shadcn's table look (muted header, row rules, hover). |

Page error handling: `PageErrorBoundary` keeps the sidebar usable and offers "Try again", which
drops the cached answers and draws the page again.

## Web: forms (`apps/web/src/ui/form.tsx`)

| Primitive     | Notes                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `Field`       | A labelled input; the label wraps the control (so it is the accessible name), the hint is its description. |
| `DateField`   | The shadcn Date Picker: a button showing the day, opening a Calendar with month and year dropdowns. Value `YYYY-MM-DD` or ''. The owner chose this over typing. |
| `TimeField`   | "HH:MM" stored 24-hour; shown in the Settings time format (12h or 24h), not the browser's.            |
| `Picker`      | shadcn Select for one value; "" (none, any, all) is a normal choice.                                  |
| `SelectField` | A labelled dropdown; `name` can give a fuller accessible name that starts with the label.             |
| `FormError`   | The one error line under a form.                                                                      |
| `Button`      | The form's button wrapper; one primary per form.                                                       |
| `Card`        | The centred card for screens before sign-in, with `PrivacyLink` under it.                             |

Forms open inline on the page (Add expense, New vehicle, Add goal). Editing reuses the same form
pre-filled, with the heading changed ("Edit goal"), "Save changes" and a Cancel that resets to the
defaults. Money fields show and read minor units through `moneyInput` and `parseMoney`.

## Web: lists and tables

- `RowMenu` (`apps/web/src/ui/RowMenu.tsx`): the "..." menu of a row, for two or more actions;
  `name` says what the row is ("Actions for Corolla"). One action stays a plain button.
- `SortTable` and `sortRows`: dense tables with keyboard navigation, column sort (ties keep their
  order, nulls last) and CSV copy (`toCsv`, `csvCell`: RFC 4180, formula-looking text gets a
  leading quote).
- `ShowMore` (`apps/web/src/ui/ShowMore.tsx`) with `usePagedList` (`apps/web/src/api/paged.ts`):
  one list that grows by a page; the button hides when the server has no more rows.
- `HourBars` (`apps/web/src/ui/HourBars.tsx`): the chart pattern. CSS columns in `bg-chart-1`, the
  busiest value labelled, a hover readout above, hour ticks every six hours in the Settings time
  format, a table with a caption that screen readers always get and a "Show as a table" toggle for
  everyone, and an `EmptyState` when there is nothing. Follow it for any new chart; add no chart
  library.
- `Qr`: the pairing code.

## Web: states and feedback

- Loading: shadcn `Skeleton` in the shape of what is coming, never a spinner alone.
- Errors from the API are problem details (`describe`, `unwrap` in `apps/web/src/api/client.ts`);
  show the server's sentence, never a bare code. A write made with `useChange()` already has it as
  `error`; a page's own check goes on the same line with `setError('Enter …')`, and
  `errorText(change, ...reads)` adds the reads' failures, for the one `FormError` under the form.
  Use `busy` to disable the button that sent the change.
- Dialogs (shadcn `Dialog`) are for confirmations and short dangerous steps. When a secret is on
  screen (a recovery key) the dialog does not close on an outside click.
- Toasts are not used on the web; messages sit in the page near what they are about.

## Phone (`apps/phone/src/ui/`)

| Primitive         | Notes                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `Screen`          | The frame of every screen, laid out like a web page: back button, title (`text-2xl` semibold tight) with optional description, content in a 16-padded column with 16 between cards. |
| `SectionLabel`    | A small label above a group of cards, like the web's section headings.                                 |
| `Rows` + `ListRow`| A card list; rows are 56 dp, accent on press, separated by a border like the web tables.               |
| `Field`           | A labelled input with an optional hint, as the web forms lay them out.                                  |
| `ToastProvider` / `useToast` | One toast at a time over the bottom bar; a new one replaces the old; read out by screen readers; errors and toasts with an action stay longer; one follow-up action so a message is never a dead end. |
| `ConfirmProvider` / `useConfirm` | shadcn AlertDialog in the palette: scrim, card, title, description, two buttons. Before anything hard to undo. |
| `Dot`             | A small dot; `pulse` breathes it to say "recording now".                                              |
| `Logo`            | The Coin Road mark; `small` under 24 dp.                                                               |
| `ErrorBoundary`   | A crash while drawing shows a way back; the tracker keeps recording natively.                          |

Home shows a checklist of what the phone still needs, a banner for unsynced data, a wrong server or
a restored server, and the running shift's distance; the shift notification carries the live
distance. New phone UI should fit into those, not add a second banner system.

## A page, in order

```tsx
<PageHeader title="Vehicles" description="The cars and bikes you drive for work.">
  <Button onClick={…}>Add vehicle</Button>
</PageHeader>
<Section title="New vehicle">…inline form…</Section>
<Section label="Your vehicles" title="Your vehicles">
  {rows.length === 0 ? <EmptyState>…</EmptyState> : <TableBox><table className={tableClass}>…</table></TableBox>}
  <ShowMore more={more} busy={loadingMore} onClick={showMore} />
</Section>
```
