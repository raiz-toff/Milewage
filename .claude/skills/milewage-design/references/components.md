# Components

There are two layers on each platform. Material components give the controls. MileWage's own
primitives give pages and screens their shape. Compose from the primitives. Use a raw component
only inside a primitive or when none fits, and then consider adding a primitive instead of
repeating markup.

## Web: the component layer (`apps/web/src/components/ui/`)

These are Radix primitives in shadcn's file layout, restyled to Material 3 and owned by MileWage.
Edit them to change the system. Import them with the `@/` alias. The variants that exist:

| Component                                                                                          | Variants and notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                                                                           | `default`: Lane yellow (primary-container), the one main action. `filled`: primary, rare. `tonal` (`secondary` is an alias; prefer `tonal`): the second most important action. `elevated`. `outline`. `ghost`: Material's text button. `destructive`: error-container. `link`: inline text with a primary underline. Sizes `default` 40 px, `xs`, `sm`, `lg` 48, `icon`, `icon-xs`, `icon-sm`, `icon-lg`. An icon-only `ghost`/`outline` button turns on-surface-variant. A pill with a state layer and a ripple. |
| `Card` (+ `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`) | `variant`: `filled` (default, `bg-card` = surface-container-low, no shadow), `outlined`, `elevated` (level 1), `highest` (stands out). `size="sm"` tightens the padding to 12. Medium corners.                                                                                                                                                                                                                                                                                                                    |
| `Badge`                                                                                            | `default` (primary-container: "Default", "Next"), `secondary`, `destructive`, `outline`, `ghost`, `link`, `count` (the error-coloured number on an icon). 24 px, small corners, label-medium.                                                                                                                                                                                                                                                                                                                     |
| `Alert`                                                                                            | `default` (surface-container-high, the icon in primary) or `destructive` (error-container). Use it for a notice inside a page, not for a form error.                                                                                                                                                                                                                                                                                                                                                              |
| `Dialog`                                                                                           | Surface-container-high, extra-large corners, level 3, a 32 % scrim. Confirmations and short dangerous steps only.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `DropdownMenu`                                                                                     | Surface-container, extra-small corners, level 2, 48 px rows (40 with a mouse). Item `variant="destructive"` is error; a checked item is secondary-container.                                                                                                                                                                                                                                                                                                                                                      |
| `Popover`, `Tooltip`                                                                               | A popover is surface-container at level 2. A tooltip is inverse-surface, body-small.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `Select`                                                                                           | Use it only through `Picker` / `SelectField`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Tabs`                                                                                             | `default` = primary tabs (a 3 px indicator under the label), `line` = secondary tabs. Period tabs on the dashboard.                                                                                                                                                                                                                                                                                                                                                                                               |
| `Switch`, `Checkbox`, `RadioGroup`                                                                 | Material controls. Prefer `CheckField` for a labelled checkbox in a form.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Table` and its parts                                                                              | A 48 px header in title-small, 52 px rows, outline-variant rules. Pages mostly use `tableClass` instead.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Sidebar` and its parts, `Sheet`                                                                   | The navigation drawer and rail (below). `Sheet` is the modal drawer on narrow screens.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Skeleton`, `Separator`, `Breadcrumb`, `Input`, `Label`, `Calendar`                                | The loading shape, an outline-variant rule, the top bar's trail, the bare input under `Field`, a label, and the grid inside `DateField`.                                                                                                                                                                                                                                                                                                                                                                          |
| `ripple.ts`                                                                                        | `ripple`, `withRipple`: the press ripple for any custom control.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Web: layout (`apps/web/src/ui/layout.tsx`)

| Primitive                                    | Use it for                                                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`                                 | The top of every page: `title`, `description`, the actions as children (at most one default button).                                          |
| `Section`                                    | A titled filled card (`title`, `description`, `action`). `label` makes it a named region. `bare` gives no card, for a section inside one.     |
| `StatCard`                                   | One figure (title-large, tabular) with a label-medium label and an optional `sub` line. A row of them sits in a grid.                         |
| `EmptyState`                                 | A dashed outline-variant box: what the list is and what to do next.                                                                           |
| `TableBox` + `tableClass`                    | The outlined, scrollable box around a plain `<table>`, with the Material data-table look: a surface-container header, 52 px rows, hover wash. |
| `MoreCard` (`ui/MoreCard.tsx`)               | Quieter tools folded under their names in one card (`rows: MoreRow[]`), so a page is not a column of empty cards.                             |
| `Est` (`ui/Est.tsx`)                         | The asterisk an estimated figure always carries. Totals never do.                                                                             |
| `PageErrorBoundary` (`ui/ErrorBoundary.tsx`) | Keeps the drawer usable when a page fails and offers "Try again".                                                                             |

A page file is a screen (or one panel of a screen), never a library. A helper, hook or type that
another file needs lives in a module (`format.ts`, `days.ts`, `shift/`, `pairing/`, ...). A
primitive another screen needs lives in `ui/`. The shift page reads one record through
`useShiftRecord(ref)` (`shift/record.ts`) and lays out from the pure `shiftView(record, settings)`
(`shift/view.ts`). A new layout rule goes there and into `test/shiftview.test.ts`.

## Web: forms (`apps/web/src/ui/form.tsx`, `apps/web/src/ui/chips.tsx`)

| Primitive             | Notes                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Field`               | A Material outlined text field, 48 px. The label rests inside and floats into the outline's notch. `hint` is the supporting text and the accessible description.            |
| `SelectField`         | A labelled dropdown in the same outlined field. `name` gives a fuller accessible name that starts with the label.                                                           |
| `Picker`              | The bare dropdown (`PickOption[]`, with an optional `icon`). `""` (none, any, all) is a normal choice. Use it inside table rows or other fields.                            |
| `DateField`           | A button in an outlined field opening a `Calendar` (month and year dropdowns) on surface-container-high. Value `YYYY-MM-DD` or `''`. The week starts from Settings.         |
| `TimeField`           | One outlined field holding hour, minute (and AM/PM) dropdowns. Stored as `HH:MM`, shown in Settings > Time format.                                                          |
| `CheckField`          | A labelled checkbox as a 48 px list row. The label toggles it too.                                                                                                          |
| `denseField`          | A class string for an unlabelled 40 px outlined input in a table row (name it with `aria-label`).                                                                           |
| `FilterChip`          | A toggle (`aria-pressed`). 32 px. Selected, it fills secondary-container and leads with a check. A filter over a list, or a quick pick (the category chips in Add expense). |
| `SegmentedButtons`    | One choice of two to five (`label`, `value`, `options`, `onChange`). 40 px, outlined, the chosen segment in secondary-container with a check.                               |
| `Button`              | The form's button: `busy` disables it. The default variant is the brand action, so pass `variant` for the others.                                                           |
| `FormError`           | The one error line under a form (`role="alert"`, error colour).                                                                                                             |
| `Card`, `PrivacyLink` | The centred large-corner card for screens before sign-in, with the logo and the privacy link under it.                                                                      |

Forms open inline on the page (Add expense, New vehicle, Add goal). Editing reuses the same form,
pre-filled, with the heading changed ("Edit goal"), "Save changes", and a Cancel that resets it.
Money fields read and show minor units through `moneyInput` and `parseMoney`. A file input is
drawn by `index.css` as a small outlined button.

## Web: lists, tables, charts

- `RowMenu` (`ui/RowMenu.tsx`): the ⋮ menu of a row, for two or more actions (`RowAction`: `label`,
  `onSelect`, `icon`, `destructive`, `disabled`). Destructive items go last after a separator, in
  error. `name` says what the row is ("Actions for Corolla"). A single action stays a plain button.
- `SortTable` with `sortRows`, `toCsv` and `csvCell`: a dense table with keyboard navigation and
  column sort (ties keep their order, nulls last). CSV copy follows RFC 4180, and formula-looking
  text gets a leading quote.
- Tables: text left, numbers right with `tabular-nums`, 52 px rows, dates through `formatDay`.
- `ShowMore` (`ui/ShowMore.tsx`) with `usePagedList`: one list that grows by a page.
- `HourBars` (`ui/HourBars.tsx`, also `hourLabel`) is the chart pattern. It draws CSS columns in
  `bg-chart-1`, labels the busiest value, shows a hover readout, and puts ticks in Settings' time
  format. A captioned table is always there for screen readers, "Show as a table" shows it to
  everyone, and an `EmptyState` covers no data. Follow it for any new chart.
- `Qr` (`ui/Qr.tsx`) is black on a white plate in both themes. `PairingCode`
  (`pairing/PairingCode.tsx`) over `usePairingSession()` is the one way to show a pairing code.

## Web: states and feedback

- Loading: a `Skeleton` in the shape of what is coming, never a spinner alone.
- API errors are problem details (`describe`, `unwrap` in `api/client.ts`). Show the server's
  sentence, never a bare code. A `useChange()` write already has it as `error`. A page's own check
  goes on the same line with `setError('Enter …')`. Use `busy` to disable the button that sent it.
- Dialog vs inline: a form is inline. A `Dialog` asks before something hard to undo ("Delete this
  trip?", with the consequence spelled out; `ghost` Cancel, `destructive` confirm) or holds a short
  dangerous step. A dialog showing a secret (a recovery key) does not close on an outside click.
- There are no toasts or snackbars on the web. Messages sit in the page next to what they are
  about (`FormError`, an `Alert`, a line of body-medium on-surface-variant text).

## Web: navigation

- The app shell (`App.tsx`) uses `Sidebar collapsible="icon"`. It is a navigation drawer on
  surface-container-low with grouped destinations (title-small group labels). The current
  destination is a secondary-container pill with its icon `filled`. The drawer collapses to a rail
  on desktop and is a modal `Sheet` on phones. The top bar holds the `SidebarTrigger`, the page
  name, the theme toggle and the notifications bell with a `count` badge.
- `SectionNav` (`ui/nav.tsx`): a page made of sections with one URL each (Settings, Help). It is a
  sticky grouped list where the container is wide and one outlined menu button where it is narrow.
  Put it in an `@container` grid with `@2xl:grid-cols-[200px_minmax(0,1fr)]`.
- `LinkRow`: a two-line list item leading to another page (body-large title, body-medium line, a
  chevron). Rows sit in `<Card className="py-0"><ul className="divide-y">`.
- `HelpLink` (`help/HelpLink.tsx`): `<HelpLink page="how-miles-are-counted">How miles are
counted</HelpLink>`, a label-large link with the help icon. It renders nothing while the owner
  has Help off. `page` is a file in `docs/help/` without `.md`. Help articles are drawn by
  `HelpMarkdown` with the system's classes per element, never `prose`.

## Web: the map (`apps/web/src/map/`)

The colours come from `m3-scheme.json` (`map/style.ts`): the canvas is surface-container-low, the
route is Lane yellow (primary-container) over an on-primary-fixed casing, in both themes. MapLibre's
controls are restyled in `index.css` onto surface-container with large or medium corners and
shadows at levels 1 and 2. The replay slider is `ElasticSlider` (`components/elastic-slider.tsx`).
A map always sits inside a `Section`. The coordinates and timeline beside it are the text
alternative.

## Android: house composables (`apps/android/app/src/main/kotlin/app/milewage/phone/ui/components/`)

| Composable                                              | Notes                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Screen`                                                | `title`, `onBack` (adds the back arrow), `actions`, and lazy-list `content`. A Material `TopAppBar` that takes surface-container once content scrolls under it. Padding and gaps are `ScreenPadding` (16 dp).                                            |
| `Rows` + `ListRow` + `RowDivider`                       | A card (surface-container-low) of Material `ListItem`s, at least 56 dp. `ListRow(headline, supporting, leading, trailing, onClick)`: trailing holds a switch, a value or a chevron. Tappable rows ripple. `Rows(label = …)` puts a `SectionLabel` above. |
| `SectionLabel`                                          | A group's name in title-small, primary colour, marked as a heading for TalkBack.                                                                                                                                                                         |
| `StatTile`                                              | `label`, `value`, `caption`, `tone` (`StatTone.NEUTRAL`, `EARNED`, `SPENT`: money only). The figure is headline-small and tabular. Read out as one sentence.                                                                                             |
| `EmptyState`                                            | `title`, `body`, an optional `icon` and at most one action.                                                                                                                                                                                              |
| `ConfirmHost` + `rememberConfirmState()`                | `confirm.ask(ConfirmRequest(title, text, confirmLabel, destructive, onConfirm))`, shown as a Material `AlertDialog` with text buttons.                                                                                                                   |
| `Snackbars` / `LocalSnackbars` / `MileWageSnackbarHost` | `LocalSnackbars.current.show(message, actionLabel, onAction)` from a coroutine. One host in `AppShell`. A message with an action stays longer.                                                                                                           |

Navigation (`ui/nav/`): `AppShell` shows first run (`WelcomeRoute`) until the phone is paired, then
the main graph under a Material `NavigationBar` with Home, Shifts and Settings. Each tab keeps its
state. `ShiftDetailRoute` opens over Shifts with a back arrow. Routes are type-safe
`@Serializable` objects in `Routes.kt`.

The screens are in progress. The committed `ui/screens/Screens.kt` holds placeholders that
exercise these parts. New screens follow the steps in SKILL.md and should fit Home's existing
places (the running shift, what the phone still needs, unsent data) rather than add a second
banner system.

## A web page, in order

```tsx
<PageHeader title="Vehicles" description="What you work with.">
  <Button onClick={…}><AddIcon />Add vehicle</Button>
</PageHeader>
<Section title="New vehicle">…inline form: Field, SelectField, Button, Button variant="ghost"…</Section>
<Section label="Your vehicles" title="Your vehicles">
  {rows.length === 0 ? (
    <EmptyState>…</EmptyState>
  ) : (
    <TableBox><table className={tableClass}>…</table></TableBox>
  )}
  <ShowMore more={more} busy={loadingMore} onClick={showMore} />
</Section>
```
