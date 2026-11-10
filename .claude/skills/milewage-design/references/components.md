# Components

There are two layers on each platform. Material components give the controls. MileWage's own
primitives give pages and screens their shape. Compose from the primitives. Use a raw component
only inside a primitive or when none fits, and then consider adding a primitive instead of
repeating markup.

## Web: the component layer (`apps/web/src/components/ui/`)

These are Radix primitives in shadcn's file layout, restyled to Material 3 and owned by MileWage.
Edit them to change the system. Import them with the `@/` alias. The variants that exist:

| Component                                                                                          | Variants and notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                                                                           | `default`: Lane yellow (primary-container) with an Asphalt label, the one main action and the only yellow control. `filled`: primary, an ink pill, rare. `tonal` (`secondary` is an alias; prefer `tonal`): a cool grey, the second most important action. `elevated` (card colour, level 1). `outline`. `ghost`: Material's text button, in ink. `destructive`: error-container. `link`: inline text with an ink underline. Sizes `default` 40 px, `xs`, `sm`, `lg` 48, `icon`, `icon-xs`, `icon-sm`, `icon-lg`. An icon-only `ghost`/`outline` button turns on-surface-variant. A pill with a state layer and a ripple. |
| `Card` (+ `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`) | `variant`: `filled` (default, `bg-card`: white on the grey page in light, surface-container in dark; no border, no shadow), `outlined` (page colour, outline-variant hairline), `elevated` (level 1), `highest` (stands out). `size="sm"` tightens the padding to 12. Medium corners.                                                                                                                                                                                                                                                                                                                                     |
| `Badge`                                                                                            | `default` (primary-container; not used: it would read as a second brand action), `secondary` ("Default", "Next": a cool grey), `destructive`, `outline`, `ghost`, `link`, `count` (the error-coloured number on an icon). 24 px, small corners, label-medium.                                                                                                                                                                                                                                                                                                                                                             |
| `Alert`                                                                                            | `default` (the card colour inside an outline-variant hairline, the icon in on-surface-variant) or `destructive` (error-container). Use it for a notice inside a page, not for a form error.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Dialog`                                                                                           | `bg-popover` (white in light, surface-container-high in dark), extra-large corners, level 3, a 32 % scrim. Confirmations and short dangerous steps only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `DropdownMenu`                                                                                     | `bg-popover`, extra-small corners, level 2, 48 px rows (40 with a mouse). Item `variant="destructive"` is error; a checked item is secondary-container.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `Popover`, `Tooltip`                                                                               | A popover is `bg-popover` at level 2. A tooltip is inverse-surface, body-small.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Select`                                                                                           | Use it only through `Picker` / `SelectField`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Tabs`                                                                                             | `default` = primary tabs (a 3 px ink indicator under the label), `line` = secondary tabs. Period tabs on the dashboard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `Switch`, `Checkbox`, `RadioGroup`                                                                 | Material controls; checked is ink (`primary`). Prefer `CheckField` for a labelled checkbox in a form.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Table` and its parts                                                                              | A 48 px header in title-small with no fill, a hairline under it, 52 px rows, outline-variant rules. Pages mostly use `tableClass` instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `Sidebar` and its parts, `Sheet`                                                                   | The navigation drawer and rail (below). `Sheet` is the modal drawer on narrow screens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Skeleton`, `Separator`, `Breadcrumb`, `Input`, `Label`, `Calendar`                                | The loading shape, an outline-variant rule, the top bar's trail, the bare input under `Field`, a label, and the grid inside `DateField`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `ripple.ts`                                                                                        | `ripple`, `withRipple`: the press ripple for any custom control.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Web: layout (`apps/web/src/ui/layout.tsx`)

| Primitive                                    | Use it for                                                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`                                 | The top of every page: `title`, `description`, the actions as children (at most one default button).                                                     |
| `Section`                                    | A titled filled card (`title`, `description`, `action`). `label` makes it a named region. `bare` gives no card, for a section inside one.                |
| `StatCard`                                   | One figure (title-large, tabular) with a label-medium label and an optional `sub` line; `tone` `earned`/`spent` for money in or out only.                |
| `EmptyState`                                 | A dashed outline-variant box: what the list is and what to do next.                                                                                      |
| `TableBox` + `tableClass`                    | The outlined, scrollable box around a plain `<table>`, with the Material data-table look: a header with no fill over a hairline, 52 px rows, hover wash. |
| `MoreCard` (`ui/MoreCard.tsx`)               | Quieter tools folded under their names in one card (`rows: MoreRow[]`), so a page is not a column of empty cards.                                        |
| `Est` (`ui/Est.tsx`)                         | The asterisk an estimated figure always carries. Totals never do.                                                                                        |
| `PageErrorBoundary` (`ui/ErrorBoundary.tsx`) | Keeps the drawer usable when a page fails and offers "Try again".                                                                                        |

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
- Charts: see "Web: charts" below. Every chart is built from `ui/charts`, never by hand.
- `PlatformBadge` (`platforms/`): the driver's colour is data, stored as chosen. It is drawn at
  Material's custom-colour tones (`platforms/tones.ts`: tone 40 with white letters in light, tone 80
  with tone 20 letters in dark, hue kept, not harmonised), so any colour holds 4.5:1. Settings >
  Platforms > Change colour offers `PRESET_COLORS`, named radios drawn as the badge they give.
- `Qr` (`ui/Qr.tsx`) is black on a white plate in both themes. `PairingCode`
  (`pairing/PairingCode.tsx`) over `usePairingSession()` is the one way to show a pairing code.

## Web: charts (`apps/web/src/ui/charts/`)

One family of chart primitives, so every chart looks and behaves alike. A chart answers one
question a driver asks ("How did this week go against the last? Where did the money come from?
When is it worth being out?"); a chart that answers none is not drawn.

**Library decision (2026-11-10).** Hand-built SVG on `d3-array` (`nice`, `ticks`) and `d3-shape`
(`stack` with the diverging offset, `line`), pinned exactly (3.2.5, 3.2.1: the d3 maintainers'
2026-11-03 releases, published from GitHub with provenance; 3.2.5 fixes a `nice` rounding error).
Both are pure maths that own no DOM, so the drawing stays in the system's tokens and states, and
nothing is fetched at run time. Measured with esbuild, minified and gzipped, for the parts a
dashboard needs (bars, stacks, a line, axes, a tooltip):

| Option                                  | gzip       | Why not                                                         |
| --------------------------------------- | ---------- | --------------------------------------------------------------- |
| **d3-array + d3-shape (chosen)**        | **≈ 6 kB** | Nice numbers, ticks, stacks and paths without reinventing them  |
| + d3-scale (`scaleLinear`, `scaleBand`) | ≈ 16 kB    | A linear map and equal bands are a few lines each (`scale.ts`)  |
| visx 4 primitives (shape, scale, axis)  | ≈ 24 kB    | Owns the axis markup; themes through props, not the roles       |
| visx 4 XYChart                          | ≈ 56 kB    | Its own tooltip and theme layer to undo                         |
| Observable Plot 0.6                     | ≈ 102 kB   | Draws its own DOM; not React                                    |
| Recharts 3.10                           | ≈ 119 kB   | The heaviest; inline styles; its own tooltip and legend markup  |
| Nivo 0.99                               | ≈ 92 kB    | Heavy, a theme object instead of CSS variables, no 2026 release |

All support React 19. The built app's main chunk went from 361.14 to 377.56 kB gzip (+16.4 kB:
about 6 kB of d3, the rest the chart primitives and the new Dashboard and Analytics sections);
CSS from 21.58 to 21.86 kB. MUI X Charts (what OpenMiles uses) is ruled out: no MUI here.

**The primitives** (import from `@/ui/charts` or `../ui/charts`):

| Primitive                          | Use it for                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChartFigure`                      | The frame of every chart: a `<figure>` named by `label`, a toolbar row (a measure switch) with **Show as a table**, the plot, the `Legend` (only with two or more series), a footnote, and the table a screen reader always gets (`sr-only` until shown).                                                                                                                               |
| `BarChart`                         | Discrete slots (days, months): one series or stacked. Bars at most 24 px with 4 px rounded data ends, a 2 px surface gap between stacked parts, a nice zero-based axis. `future` slots draw nothing and the keyboard skips them; `emphasis` draws one slot in colour and the rest in `chart-other` (today against the week). One direct label: the tallest slot, or the emphasised one. |
| `LineChart`                        | A measure continuous over the slots (a running total): 2 px lines, the last point ringed. `dots` for a rate that exists only on some slots (pay per hour on days worked): markers, never a line across a gap. `reference` draws one hairline (the period's figure); its words go in the figure's note.                                                                                  |
| `Heatmap`                          | A grid (weekdays by 3-hour blocks): one hue in five validated steps (`HEAT_STEPS`), a scale legend, a muted cell with a hairline for "no shifts". Arrow keys move across and down.                                                                                                                                                                                                      |
| `SegmentBar`                       | One whole split into parts, read beside its figures: a thin 8 px bar with rounded ends and 2 px gaps over a list of swatch, name, figure and share. Zero parts are left out.                                                                                                                                                                                                            |
| `RankBars`                         | Parts compared with each other: one bar per part, largest first, **one hue** (the badge or the name carries identity).                                                                                                                                                                                                                                                                  |
| `InlineBar`, `Sparkline`           | A bar beside a figure in a table cell; tiny columns of a row's figures across the period (columns, so days off read as gaps).                                                                                                                                                                                                                                                           |
| `ChartSkeleton`, `ChartEmpty`      | Loading in the chart's shape (never a spinner); no data in words with one way forward ("No shifts this week yet. Start one on your phone.").                                                                                                                                                                                                                                            |
| `Comparison` (`ui/Comparison.tsx`) | A figure against the period before in words and with the sign as an arrow, never colour alone: "↓ $43.25 (26%) less than by this point last week ($167.64)". A running period is compared to the same point (`comparedWith` in `series.ts`).                                                                                                                                            |
| `scale.ts`                         | The pure maths, tested: `valueAxis`, `bands`, `labelStep`, `stackRows`, `linePath`, `topRoundedRect`, `binOf`, `percent`.                                                                                                                                                                                                                                                               |

**The rules every chart keeps.**

- Hairline grid in `chart-grid`, the baseline in `chart-axis`, labels in label-small
  `on-surface-variant` with tabular figures; no chart junk, no dual axes, no donut.
- Hover and keyboard focus show the same tooltip (Material's plain tooltip: inverse-surface,
  extra-small corners). The value leads, the slot follows, each series keyed by a short stroke. The
  plot is one tab stop with `aria-roledescription="chart"`; the arrow keys, Home and End move between
  slots, Escape lets go, and a polite live region reads the slot. The hovered slot gets the state
  layer (on-surface at 8 %). Tooltips never gate: every value is in the table.
- Every figure goes through the formatters (`formatMoney`, `formatMoneyTick`, `formatDistance`,
  `formatDistanceTick`, `formatHours`, `hourLabel`) in the driver's currency, unit and time format;
  weeks start at `settings.week_start`. A slot with nothing entered is "Not entered", never 0.
- Colour: money in `chart-earned` (tips a 50 % tint of it), money out `chart-spent`, distance and
  time the steel `chart-measure` (deadhead a 45 % tint), personal distance `chart-series-7`, the
  period before and folded tails `chart-other`, platforms by their place in the driver's list
  (`usePlatformColors`: slot 1 to 8, the same in every chart and period). Tints are
  `tint(color, pct)`, a `color-mix` with the card in OKLab, so both themes follow.
- One short entrance (`chart-rise`: the marks grow from the baseline, medium2, emphasized
  decelerate) and none under reduced motion. Sizes come from the box (`useWidth`, a
  ResizeObserver).
- A chart whose module is off, or with nothing to draw, is not rendered at all; the layout closes
  up (no empty card).
- Estimates carry the asterisk and say so in the footnote (active and deadhead, the heatmap's
  spread of a shift's pay over its hours).

**Where they are used.** Dashboard (`pages/DashboardTrend.tsx`): the comparison under the earned
figure, one trend chart per period tab (Today against the six days before; Week, Month and 30 days
by day; Year by month) with an Earned / Distance / Time switch, and one breakdown card (where the
money came from with two or more platforms, else where the miles went). Analytics
(`pages/AnalyticsCharts.tsx`): earnings stacked by platform (or pay and tips), the pace against the
period before, pay per hour and per mile as two small multiples, distance by kind, when it pays,
money in and out, and the platform and vehicle tables. The data is `GET /summary/series` and
`GET /analytics/breakdown` (`series.ts`).

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
  the page's own colour (`background`) with grouped destinations (title-small group labels). The
  current destination is a secondary-container (cool grey) pill with its icon `filled` and a short
  Lane yellow dash at its leading edge, the lane mark (decoration; the pill and `aria-current`
  carry the state). The drawer collapses to a rail
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

The colours come from `m3-scheme.json` (`map/style.ts`): the blank canvas is a step off the card
(surface-container-low in light, the Asphalt page in dark), the route is Lane yellow
(primary-container) over an on-primary-fixed casing, in both themes. The map is where the yellow
lives; the small route sketch in a list (`RouteSketch`) is a quiet ink line on a `bg-muted` tile. MapLibre's
controls are restyled in `index.css` onto surface-container with large or medium corners and
shadows at levels 1 and 2. The replay slider is `ElasticSlider` (`components/elastic-slider.tsx`).
A map always sits inside a `Section`. The coordinates and timeline beside it are the text
alternative.

## Android: house composables (`apps/android/app/src/main/kotlin/app/milewage/phone/ui/components/`)

| Composable                                              | Notes                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Screen`                                                | `title`, `onBack` (adds the back arrow), `actions`, and lazy-list `content`, all on the page (`surfaces.page`). The `TopAppBar` keeps the page colour and shows an outline-variant hairline once content scrolls under it (no tonal tint). Padding and gaps are `ScreenPadding` (16 dp). `BottomAction` holds the screen's one main action on the page.                                   |
| `CardSurface`                                           | The card: `surfaces.card` (white in light, surface-container in dark), medium corners, no border, no shadow. Every card is this; never a card inside a card (use `surfaces.fill` for a highlighted block on a card, as Connect's found servers do).                                                                                                                                       |
| `Rows` + `ListRow` + `RowDivider`                       | A `CardSurface` of Material `ListItem`s, at least 56 dp, divided by outline-variant hairlines. `ListRow(headline, supporting, leading, trailing, onClick)`: trailing holds a switch, a value or a chevron. Tappable rows ripple. `Rows(label = …)` puts a `SectionLabel` above.                                                                                                           |
| `SectionLabel`                                          | A group's name in title-small, ink (`primary`), marked as a heading for TalkBack.                                                                                                                                                                                                                                                                                                         |
| `StatTile`, `StatCell`, `FigureRow`                     | `label`, `value`, `caption`, `tone` (`StatTone.NEUTRAL`, `EARNED`, `SPENT`: money only). The figure is headline-small and tabular, read out as one sentence. `StatTile` is a figure on its own card; figures that belong together are `StatCell`s in a `FigureRow` (equal heights, vertical hairlines) inside one card, under the screen's big figure (Home's summary, a shift's totals). |
| `NoticeCard`                                            | Icon, title, body (on-surface-variant), at most one outlined action and a text action. `Tone.NEUTRAL` is a card; `WARNING` is outlined (the page colour inside an outline-variant hairline, the web's `Alert`), never a tint; `PROBLEM` is error-container.                                                                                                                               |
| `RouteSketch`                                           | The shift's route on a Canvas: a Lane yellow lane line (`primaryContainer`) on an asphalt ribbon (`surfaces.road`), the start a ring, the end a square, stops dots, all ink with a card-coloured halo. The dark ribbon carries the route on the white card in light; the yellow carries it in dark.                                                                                       |
| `EmptyState`                                            | `title`, `body`, an optional `icon` and at most one action.                                                                                                                                                                                                                                                                                                                               |
| `ConfirmHost` + `rememberConfirmState()`                | `confirm.ask(ConfirmRequest(title, text, confirmLabel, destructive, onConfirm))`, shown as a Material `AlertDialog` with text buttons.                                                                                                                                                                                                                                                    |
| `BrandButton`                                           | The one brand action on a screen: primary-container (Lane yellow) with on-primary-container (Asphalt) content, 56 dp, `BrandSize.VEHICLE` 64 dp in the car (Start shift); `busy` shows a spinner. Every other action is tonal, outlined or text.                                                                                                                                          |
| `Snackbars` / `LocalSnackbars` / `MileWageSnackbarHost` | `LocalSnackbars.current.show(message, actionLabel, onAction)` from a coroutine. One host in `AppShell`. A message with an action stays longer. Inverse-surface, the action in `inversePrimary` (steel on Android, tokens.md).                                                                                                                                                             |

Navigation (`ui/nav/`): `AppShell` shows first run (`WelcomeRoute`) until the phone is paired, the
setup steps (Connected, permissions, Ready) after a first connection, then the main graph under a
Material `NavigationBar` with Home, Shifts and Settings (outlined icons, filled when selected), drawn by
`MainNavigationBar`: on the page colour under an outline-variant hairline, the selected item in the
secondary-container pill, and a 24 x 3 dp Lane yellow dash on the hairline above it (the lane mark,
decoration only). Each tab keeps its state. `ShiftDetailRoute` opens over Shifts with a back arrow. Routes are type-safe
`@Serializable` objects in `Routes.kt`.

New screens follow the steps in SKILL.md and should fit Home's existing places (the running
shift, what the phone still needs, unsent data) rather than add a second banner system.

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
