---
name: milewage-design
description: The MileWage design system, Material Design 3 with the brand mixed in. It covers the colour roles (neutral Asphalt surfaces, ink, Lane yellow only as the lane mark), earned and spent, the chart palette, Roboto Flex and the Material type scale, shape, elevation, state layers and ripple, Material Symbols, the restyled web components and the house primitives for the web app (apps/web), the native Android app's theme and house composables (apps/android, Kotlin and Jetpack Compose), plus the writing voice and the money, date, time and distance formats. Load this before building or changing ANY user-facing screen, component, page, dialog, chart, empty state, notification text or driver-facing copy in apps/web or apps/android, and before adding colours, fonts or icons anywhere. The retired Expo app (apps/phone) was removed on 2026-11-10. Use it even when the request only says "add a page", "make a form", "a new screen", "show this on the dashboard", "a button for", "a card with", "restyle", "dark mode", "looks off", "make it match", or asks for a mockup, wireframe or design file for MileWage.
---

# MileWage design system

MileWage is a self-hosted mileage tracker for gig drivers. Both apps are built on **Material
Design 3, baseline** (m3.material.io, the 2021 spec; not the "Expressive" alpha), with the brand
mixed in. The brand guide's two colours set the look: **Asphalt** `#101214` and **Lane yellow**
`#FFC21F`. A lane line is a thin mark on a lot of asphalt, and the interface is built the same
way: neutral, slightly cool surfaces at Asphalt's own hue, ink for structure, and the yellow only
where it means MileWage or "go" (the one main action on a screen, the map's route, the logo).
The Coin Road logo, the voice and the number formats belong to MileWage. New work looks right when
it uses the roles and primitives below. It looks wrong when it invents a colour, a size or a tone.
Read this file first, then the reference for your task:

- [references/tokens.md](references/tokens.md): every colour role in light and dark, the shadcn
  names, the type, shape, elevation, state and motion tokens, the Android equivalents, and how to
  regenerate the scheme. Read it when you touch a colour, a class name or a stylesheet.
- [references/components.md](references/components.md): the web component variants and house
  primitives, the Android house composables, and the patterns (header, cards, tables, forms,
  dialogs, menus, messages, navigation, map). Read it before composing a page or a screen.
- [references/voice-and-formats.md](references/voice-and-formats.md): how MileWage speaks, and the
  helpers for money, dates, clock times, distance and duration on the web and on Android. Read it
  before writing any text a driver reads or showing any number.

The brand marks live in `branding/`. Its README is the brand guide: symbol, lockups, app icons,
clear space and minimum sizes.

## The system in one screen

**Colour.** `apps/web/scripts/m3-theme.mjs` builds the scheme with Google's
material-color-utilities from explicit palettes: neutrals at Asphalt's hue (243, chroma 4 and 8),
a neutral secondary, and the seed's own palette for the yellow roles; then a short, documented
table of overrides (tokens.md). Android's `BrandColors` must match it role by role (tests), with
one Android-only value: `inversePrimary`, the snackbar action (below).
**`primary` is ink, not yellow**: Asphalt-dark in light (`#242628`), near-white in dark. The
brand yellow is **`primary-container`**, exactly `#FFC21F` in both themes, with an Asphalt label.
No neutral role carries any yellow (a test holds chroma under 0.02). The roles and their jobs:

| Role                                   | For                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `background` / `on-surface`            | The page, the top bar and the drawer: a cool light grey in light, Asphalt in dark                                |
| `bg-card` (lowest / surface-container) | Cards, sections, stat tiles: white in light, one step above Asphalt in dark                                      |
| `bg-muted` (high / highest)            | A fill on a card: a skeleton, a code block, a highlighted row                                                    |
| `bg-popover` (lowest / high)           | Menus, popovers, dialogs, the date picker, sheets, with their Material shadow                                    |
| `on-surface-variant`                   | Secondary text, labels, hints, icons                                                                             |
| `outline`                              | Text-field and outlined-button outlines, a checkbox's border                                                     |
| `outline-variant`                      | Dividers, table rules, the outlined card, an `Alert`'s hairline, the dashed empty state                          |
| `primary` (ink)                        | Text and outlined buttons, links, a focused field, checked controls, progress, the tab indicator, the focus ring |
| `primary-container` (Lane yellow)      | The one main action, the map's route, the drawer's lane dash; nothing else                                       |
| `secondary-container` (cool grey)      | Selection: the active navigation pill, a chosen chip or segment, the tonal button, the `Next` badge              |
| `error` / `error-container`            | Destructive actions, invalid fields, `FormError`, the unread `count` badge                                       |
| `inverse-surface`                      | Tooltips; Android snackbars, whose action is `inversePrimary` (Android: steel, not the web's yellow or gold)     |
| `scrim`                                | Behind dialogs and sheets, at 32 %                                                                               |
| `earned` / `spent` (extended)          | Money in / money out, and nothing else                                                                           |
| `chart-*` (extended)                   | Charts only: eight series, earned, spent, the steel `measure`, `other`, grid and axis (tokens.md)                |
| `tertiary` (teal), `signal` (extended) | Unused. Do not spend them on decoration                                                                          |

**Where the yellow appears, the complete list:** the logo; the one main action per screen
(`<Button>` default, Android's `BrandButton` / extended FAB); the route (and place circles and
markers) on a map, and on Android the lane line of the shift's route sketch (on an asphalt ribbon);
a short lane dash at the leading edge of the current destination in the navigation drawer and
rail, and on Android above the selected item of the bottom navigation bar; on Android the QR
scanner's viewfinder corners (the scan screen's one target, on the camera image). Android's
notification accent is the yellow too (the system draws it). Nowhere else: not as a fill, a tint, a chart colour, a focus ring, a
progress bar or a badge (the `default` badge exists but is not used).

**One brand action per screen.** On the web this is `<Button>` with no variant: `default` is
primary-container (Lane yellow) with an Asphalt label. Every other action is `tonal`, `outline`,
`ghost` or `link`. `filled` (Material's `primary` filled button, an ink pill) is for a strong action that is
not the brand one, and it is rare. On Android, Material's `Button` is `primary`, not yellow. The brand
action is a `Button` with
`ButtonDefaults.buttonColors(containerColor = colorScheme.primaryContainer, contentColor = colorScheme.onPrimaryContainer)`,
the house `BrandButton` (56 dp, `BrandSize.VEHICLE` 64 dp for Start shift), or an
`ExtendedFloatingActionButton`, whose Material default is primary-container.

**Money colours.** `earned` (a clean green) is money in and `spent` (an orange, kept visibly apart
from `error`'s red) is money out. Neither is bent toward the yellow. Use them only on money figures, never as the only signal: the label says it in words. They
never mark status. Destructive actions use Material's `error`, never `spent`. On the web they mark
only headline figures (the dashboard's earned figure, a shift's Earned, Expenses' total spend,
Analytics' gross, expenses and net by its sign), through `StatCard tone` or `moneyText`; tables
and lists stay plain.

**Themes.** On the web, light is the default. The app follows the OS or the Settings choice:
`apps/web/src/theme.ts` toggles `.dark` on `<html>`, and `THEME_COLORS` feeds `theme-color`.
Android follows the system's light or dark setting. Settings > Use wallpaper colours (off by
default, Android 12+) swaps the scheme for the phone's dynamic colours, with earned and spent
re-harmonised. Check every change in both themes on both platforms.

**Type.** The web uses Roboto Flex (variable, bundled by fontsource) and Roboto Mono for codes and
keys. Use Material's type scale as utilities (`text-headline-small`, `text-title-medium`,
`text-body-medium`, `text-label-large` ...), which set size, line height, tracking and weight
together. Do not use Tailwind's `text-sm`, `text-2xl` or `font-semibold` in new work. Android uses
`MaterialTheme.typography` on the system font (Roboto on most phones). Nothing is bundled there.
Numbers that line up get tabular figures: `tabular-nums` on the web, `.tabular()` on Android.

**Shape.** Material's corner scale: extra-small 4 (fields, menus, tooltips), small 8 (chips,
badges), medium 12 (cards, tables, alerts), large 16 (the date picker, the sign-in card),
extra-large 28 (dialogs), full (buttons, the navigation pill, segmented ends). Android uses the
same values through `Shapes()`.

**Surfaces and elevation.** Use the surface model (tokens.md): page `bg-background`, card
`bg-card`, a fill on a card `bg-muted`, a floating thing `bg-popover`. In light a card is white on
a cool grey page; in dark it is one step lighter than the Asphalt page. A card has no shadow and
no border; it reads by lightness. On Android the levels are `MaterialTheme.surfaces.page`, `.card`,
`.fill`, `.popover` (and `.road` for the route sketch), and every card is `CardSurface`. Lists inside a card are rows divided by `outline-variant`
hairlines, not boxes in a box. Shadows exist only where Material draws them: level 1 on `elevated`
buttons and cards and on a filled button's hover, level 2 on menus and popovers, level 3 on
dialogs and the date picker.

**States.** Hover, focus and press are Material state layers: a wash of the content colour at
8 / 10 / 10 % (the `state-layer` utility) plus a ripple from the point pressed (`withRipple`).
Focus shows a 3 px ink ring (`primary`) 2 px off the control (`focus-ring`). Never remove it. Disabled
is on-surface at 38 % text over a 12 % fill. Reduced motion turns the ripple and transitions off.

**Icons.** Web: Material Symbols, Rounded, weight 400, through the named exports of
`apps/web/src/ui/icons.tsx` (`AddIcon`, `DeleteIcon`, `ShiftsIcon` ...). They are bundled per icon
from `@iconify-icons/material-symbols` and drawn offline. There is no icon font and no network
fetch. Sizes: 24 standalone, 20 in a button, 18 in dense spots. The filled form is only for the
selected navigation item (`filled`). Android: the same symbols and names in `app.milewage.phone.ui.icons.Icons`
(`Icons.Add`, `Icons.Shifts`, `Icons.ShiftsFilled` for the selected tab), Kotlin vectors generated
from the same data by `apps/android/scripts/material-symbols.mjs`; no `material-icons-core`.

**Spacing and targets.** 16 between cards and inside them, 8 between related rows, 24 inside
dialogs. Web controls are 40 px (buttons, segments), fields 48, menu rows 48 (40 with a mouse),
table rows 52. On Android, list rows are at least 56 dp. The in-car actions are larger, 64 dp for a
start or end shift, because the phone sits in a mount.

**Layers.** `apps/web/src/components/ui/` holds MileWage's own Radix components, restyled to
Material. Edit them when the system changes. A component added with the shadcn CLI arrives with
shadcn defaults and lucide imports, so restyle it to the roles and swap its icons for
`@/ui/icons` before use. Page primitives live in `apps/web/src/ui/` and Android ones in
`apps/android/app/src/main/kotlin/app/milewage/phone/ui/components/`.

## How to build a web page

1. Start with `PageHeader`: the title (headline-small, headline-medium from `md`), one line of
   context, and the page's actions on the right, with at most one default (yellow) button.
2. Group content in `Section` cards: `bg-card` (white on the grey page in light), title-medium title. Give a
   `Section` a `label` when tests or screen readers need it by name. `bare` drops the card for a
   section inside another card. A card inside a card is wrong; use `bare` or a divider.
3. Figures go in `StatCard`. Lists go in a `TableBox` with `tableClass` on a plain `<table>` (52 px
   rows, numbers right-aligned with `tabular-nums`), in `SortTable` for sortable data, or in a card
   list with `RowMenu` per row.
4. An empty list says what it is and what to do next, in `EmptyState`. Never show an empty table.
5. Forms sit inline on the page: `Field`, `SelectField`, `DateField`, `CheckField`, `FilterChip`,
   `SegmentedButtons`, with `FormError` under the form. A `Dialog` is only for a
   confirmation or a short, dangerous step.
6. Lists longer than one page end with `ShowMore` (`usePagedList`, `apps/web/src/api/paged.ts`).
7. Data comes through TanStack Query (`apps/web/src/api/query.ts`). Read with `useApiQuery` and
   make every write with `useChange()`, which gives `{ run, busy, error, setError }`.
   `run((api) => api.POST(…))` never throws. After a change succeeds, every cached read is asked
   again. The form's one error line is `errorText(change, ...reads)`. Read settings with
   `useSettings()` and change them only with `run(...settingsPatch(p))`. Money is in minor units of
   the instance currency, and dates are in the instance time zone. Use the helpers.
8. Check light and dark, a 360 px phone browser and a desktop. Write the test next to the page's
   tests (`apps/web/test/*.test.tsx`). Tests find things by role and name, so give controls real
   names.

## How to build an Android screen

Every screen exists (first run and pairing, permissions, Home, Shifts, shift detail, Settings,
Diagnostics). New ones follow the same steps:

1. Keep the composable thin. It renders state from a view model (`androidx.lifecycle` ViewModel,
   state collected with `collectAsStateWithLifecycle`) and sends events back. Logic and formatting
   live in the view model or in `:core` (`app.milewage.core`), where they are unit-tested on the
   JVM.
2. Wrap the screen in `Screen` (a top app bar with the title, an optional back arrow and actions,
   and a lazy column 16 dp from the edges with 16 between items). Top-level screens sit in
   `AppShell`, which draws the bottom `NavigationBar` (Home, Shifts, Settings) and the one snackbar
   host.
3. Compose from the house parts: `CardSurface` for any card, `Rows` + `ListRow` + `RowDivider`
   under a `SectionLabel`, `StatTile` for a lone figure or `StatCell`s in a `FigureRow` for
   figures that belong together in one card (with `StatTone.EARNED` / `SPENT` only for money), `EmptyState`, `ConfirmHost` with
   `rememberConfirmState()` before anything hard to undo, and `LocalSnackbars.current.show(...)` for
   short messages. A problem message always carries one action.
4. Colours come from `MaterialTheme.surfaces.*` (the level: page, card, fill, popover),
   `MaterialTheme.colorScheme.*` and `MaterialTheme.extendedColors.*`. A screen never branches on
   the theme to pick a container. Type
   comes from `MaterialTheme.typography.*`. Never put a hex or a `Color(0x…)` in a screen.
5. Every string goes in `res/values/strings.xml` (the app) or `tracking/src/main/res/values/strings.xml`
   (notifications), in the voice. Plurals use `<plurals>`. Numbers come from the `:core`
   formatters.
6. Design for the car: one-hand reach, targets of at least 48 dp (64 for start and end shift), the
   live figure large, nothing that needs reading while moving. It must work in light, dark and
   wallpaper colours.
7. Nobody can run an emulator here. The owner tests on a phone. Run `./gradlew test lint` from
   `apps/android`, and say in your report exactly what is untested on a device.

## Rules that are easy to break

- **Never hard-code a colour.** Use a role: a Tailwind class (`bg-surface-container`,
  `text-on-surface-variant`) or `MaterialTheme.colorScheme.*`. A missing role is added to the
  generator, never written as hex in a page. The QR plate (`qr-ink`, `qr-plate`) and the logo's
  brand constants are the only fixed colours. A platform's badge colour is the driver's data, drawn
  at Material tones by `platforms/tones.ts`.
- **`bg-primary` is ink, not the brand yellow.** Use `bg-primary-container` for the yellow, and only
  for the one main action, the map's route or a brand mark (the complete list is under Colour).
  `primary` is for text buttons, links, checked controls, progress and the focus ring.
- **The yellow is a mark, never an atmosphere.** No yellow or warm tint on a surface, a panel, a
  selection or a chart. A new place for the yellow is a design decision, not a styling one: add it
  to the list under Colour or do not add it.
- **One yellow action per screen**, on both platforms. A second important action is `tonal`.
- **Destructive means `error`** (`variant="destructive"`, `RowAction.destructive`, the error
  colours on Android). `earned` and `spent` are for money only, never for status ("sent", "ok",
  "failed"). Say a status in words.
- **Use the levels, not raw containers**: page `bg-background`, card `bg-card`, a fill on a card
  `bg-muted`, a floating surface `bg-popover`. They map to different containers in light and dark
  (tokens.md), so a raw `bg-surface-container-*` on a page is usually wrong in one theme. Never a
  card inside a card, never a shadow on a plain card.
- **Contrast**: text 4.5:1, meaningful marks (field outlines, chart bars, icons that carry meaning,
  the focus ring) 3:1, in both themes. The brand yellow fails 3:1 on white, so it never carries
  meaning as a mark on a light surface. `apps/web/test/m3-contrast.test.ts` holds the scheme to
  that, so a new pairing you invent must be checked by hand or added there.
- **Charts use the chart tokens**: `chart-series-1` … `8` in order for identity, `chart-earned` /
  `chart-spent` for money, `chart-measure` (steel) for distance and time, `chart-other`,
  `chart-grid`, `chart-axis`. Never `primary`, never the yellow.
- **Every chart has a text alternative**: a table a screen reader always gets and a visible "Show
  as a table", and keyboard reading. Build charts only from `ui/charts` (components.md, "Web:
  charts"); the only chart dependencies are `d3-array` and `d3-shape`. Add no chart library.
- **A measurement not computed yet is a dash** (`formatDistance(null)` on the web, `DASH` on
  Android), never 0. Money that does not exist yet reads "not available" or "not entered".
- **Dates, times, money and distance come from the formatting helpers** in the driver's settings,
  never from `toLocaleString()` or the phone's locale alone.
- **Icons come from `@/ui/icons`** on the web. Do not import `@iconify-icons/*` in a page and do not
  add lucide or an icon font.
- **Write for a driver at the end of a shift**: short sentences, plain words, no exclamation marks.
  See the voice reference.

## Delivering a design, not code

When asked for a design file, mockup or wireframe rather than a build, produce one HTML page (an
Artifact if available) that imports nothing but Roboto Flex (Google Fonts) and uses the exact role
values from [references/tokens.md](references/tokens.md), defined as `--md-sys-color-*` custom
properties for light and for dark. Use the Material type scale and the corner scale, and show both
themes. Name the role behind every colour, follow the surface model (page `background`, white or
surface-container cards, `popover` for floating things), and draw the one main action in
primary-container; the yellow appears nowhere else but the logo and a map's route. For
Android, draw at 360 x 800 dp with the bottom navigation bar. Keep to the screens asked for: this
system has no decorative layer to show off.

## What changed on 2026-11-10

For anyone who knew the previous system:

- Geist became Roboto Flex on the web and the system font on Android. The shadcn type sizes gave
  way to the Material type-scale utilities.
- lucide became Material Symbols Rounded through `ui/icons.tsx`.
- The shadcn palette became Material 3 roles generated from Lane yellow (superseded the same day,
  below). The shadcn names
  (`bg-card`, `text-muted-foreground`, ...) still work and map to roles (tokens.md). Focus rings are
  ink (`primary`), never yellow.
- `components/ui/*` are MileWage's restyled components. Edit them; the old "never edit" rule is
  gone.
- Cards lost their border and became tonal fills. Shadows exist at Material's elevation levels.
- The phone is no longer always dark. It follows the system.
- The Expo app (`apps/phone`) was retired and removed on 2026-11-10; the native app in `apps/android` replaces it.
- 2026-11-10, later ("Asphalt and lane", after the owner found the all-yellow scheme heavy): the
  neutrals moved to Asphalt's cool hue with no yellow in them; `primary` became ink; the yellow
  is only the main action, the map's route, the logo and the drawer's lane dash; light pages are
  a cool grey under white cards and dark pages are Asphalt; `on-primary-container` is Asphalt;
  selection is a cool grey; money colours are no longer harmonised (spent is an orange); the
  focus ring is ink; a chart palette was added; tables lost their header fill. The Android app
  followed the same day: `BrandColors` equal to the JSON (pinned by `BrandSchemeTest`), the
  surface model as `MaterialTheme.surfaces` and `CardSurface`, the page-coloured top and bottom
  bars with hairlines, the lane dash over the selected tab, the route sketch as a yellow lane on
  an asphalt ribbon, and `ContrastTest` for the pairs the app draws.
