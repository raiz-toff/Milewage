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
| `MoreCard` (`ui/MoreCard.tsx`) | Quieter tools folded under their names in one card (a shift's odometer, notes and export; the tax details), so a page is not a column of empty cards. |
| `Est` (`ui/Est.tsx`) | The asterisk an estimated figure always carries ("Estimated from detected stops"). Totals never do. |

A page file is a screen (or one panel of a screen), never a library: a helper, hook or type that
another file needs lives in a module (`format.ts`, `days.ts`, `goals.ts`, `vehicles.ts`,
`notifications.ts`, `pairing/`, `shift/`), and a primitive another screen needs lives in `ui/`.

The shift page reads one record: `useShiftRecord(ref)` (`apps/web/src/shift/record.ts`) gives the
shift, its trips, stops, route, earnings, odometer readings and vehicle from the cached reads, and
`view`, the pure `shiftView(record, settings)` (`shift/view.ts`) with every layout flag and header
figure. Its panels take their part of the record as props and report nothing back up; a new
layout rule goes into `shiftView` and its table test (`test/shiftview.test.ts`), not the page.

Page error handling: `PageErrorBoundary` keeps the sidebar usable and offers "Try again", which
drops the cached answers and draws the page again.

## Web: section navigation (`apps/web/src/ui/nav.tsx`)

| Primitive    | Use it for                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `SectionNav` | A page made of sections or pages with one URL each (Settings, Help). `label` names the navigation, `noun` starts the narrow button ("Section: Units and format", "Page: FAQ"), `groups` are `{ label, items: { to, label }[] }`. A grouped side list that stays in view where the container is wide, one menu button where it is narrow; never scrolls sideways. Put it in an `@container` grid with `@2xl:grid-cols-[200px_minmax(0,1fr)]`. |
| `LinkRow`    | A row that leads to another page: title, one line about it, a chevron. Rows sit in `<Card className="py-0"><ul className="divide-y">` (Settings' "Elsewhere in MileWage", the Help index). |

## Web: Help (`apps/web/src/help/`)

- `HelpLink`: `<HelpLink page="how-miles-are-counted">How miles are counted</HelpLink>`. A muted
  `CircleHelp` link (16 px icon, `text-sm font-medium text-muted-foreground`, underline on hover)
  to `/help/<page>`. It renders nothing while the owner has Help off (Settings > Help pages), so
  place it freely: a `Section`'s `action`, the end of a `PageHeader` description, a line above a
  panel. The caller writes the words; say what the driver will learn ("What a new key changes"),
  not "Learn more". `page` must be a file name in `docs/help/` without `.md` (a test checks it),
  and the page's `module` must match the screen's.
- Help pages: the Markdown of `docs/help/*.md` is drawn by `HelpMarkdown` with the design system's
  classes per element, never with `prose` (`@tailwindcss/typography` brings its own greys and
  scale): `h2` `scroll-mt-20 pt-4 text-lg font-semibold tracking-tight`, `h3` `text-base
  font-medium`, `p` `leading-7`, lists `list-disc`/`list-decimal space-y-2 pl-5`, links `font-medium
  text-foreground underline underline-offset-4`, inline code `rounded bg-muted px-1.5 py-0.5
  font-mono text-[0.85em]`, code blocks `rounded-lg border bg-muted p-3 font-mono text-sm`, quotes
  `border-l-2 pl-4 text-muted-foreground`, tables in `TableBox` with `tableClass`, rules as
  `Separator`. No raw HTML and no images in pages. The article is `max-w-3xl space-y-4`; a page
  with three or more `##` headings gets an "On this page" box.

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
- `Qr`: a QR image. `PairingCode` (`apps/web/src/pairing/PairingCode.tsx`) is the pairing QR with its
  links, addresses and Change address, over `usePairingSession()` (`pairing/session.ts`: `{ code,
  state, error, busy, renew }`), which mints the code, polls for the phone with `refetchInterval`
  and replaces a code that runs out. Devices and the setup wizard both use it; a new place that
  pairs a phone does too.

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
