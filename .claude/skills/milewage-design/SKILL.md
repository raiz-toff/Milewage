---
name: milewage-design
description: The MileWage design system: palette and theme tokens, Geist type, radius scale, the shadcn/ui components and the repo's own layout, form, table, menu, toast and screen primitives for the web app and the Android phone app, plus the writing voice and the money, date, time and distance formats. Load this before building or changing ANY user-facing screen, component, page, dialog, chart, empty state, notification text or driver-facing copy in apps/web or apps/phone, and before adding colours, fonts or icons anywhere. Use it even when the request only says "add a page", "make a form", "show this on the dashboard", "a button for", "a card with", "restyle", "dark mode", "looks off", "make it match", or asks for a mockup, wireframe or design file for MileWage.
---

# MileWage design system

MileWage is a self-hosted mileage tracker for gig drivers. Everything a driver sees was built from
one small system: the brand palette under shadcn/ui's token names, Geist, one radius scale, a
handful of layout primitives, and a plain-English voice. New work looks right when it reuses those
and wrong when it invents a colour, a font size or a tone of its own. Read this file first, then the
reference that matches your task:

- [references/tokens.md](references/tokens.md): every colour in light, dark and on the phone, the
  type scale, radius, spacing, icons. Read it when you touch a colour, a class name or a stylesheet.
- [references/components.md](references/components.md): the web primitives (`PageHeader`,
  `Section`, `StatCard`, `EmptyState`, `TableBox`, `SectionNav`, `LinkRow`, `HelpLink`, `RowMenu`,
  `Field`, `DateField`, `TimeField`, `Picker`, `SelectField`, `ShowMore`, `HourBars`), the shadcn set that is installed, and the phone
  primitives (`Screen`, `ListRow`, `Rows`, `SectionLabel`, `Field`, `Toast`, `ConfirmProvider`,
  `Logo`, `Dot`). Read it before composing a page or a screen.
- [references/voice-and-formats.md](references/voice-and-formats.md): how MileWage speaks, and the
  helpers for money, dates, clock times, distance and duration. Read it before writing any text a
  driver reads or showing any number.

The brand marks live in `branding/` (its README is the brand guide: Coin Road symbol, lockups, app
icons, clear space, minimum sizes, the do-nots).

## The system in one screen

**Palette** (owner decision 2026-11-06, index of decisions in `DECISIONS.md`). Five brand colours
and a grey ramp, exposed under shadcn/ui names so components read the same on web and phone:

| Role                   | Token                               | Meaning                                                          |
| ---------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| Lane yellow `#FFC21F`  | `primary`, `ring`, `sidebar-primary` | The brand and the one primary action on a screen                 |
| Asphalt `#101214`      | `foreground` (light), `background` (dark) | Canvas, ink and outlines                                    |
| Earned `#34D399` / `#0F9F6E` | `earned`                      | Money in. Nothing else is green                                  |
| Spent `#FF6B5E` / `#D93F33`  | `spent`, `destructive`        | Money out, and destructive actions                               |
| Signal blue `#4C8DFF` / `#2F6FE0` | `signal`                 | Reserved: the live position marker only. The live map was removed, so today nothing uses it. Do not spend it on anything else |

The darker values are the light theme's, where the brand hues would be too pale on white. Charts use
`chart-1` to `chart-5`; in light mode `chart-1` is a darker amber because the brand yellow is 1.6:1
on a white card and a chart mark needs 3:1.

**Themes.** The web app is light by default and follows the OS or the Settings choice
(`apps/web/src/theme.ts` toggles the `dark` class). The phone app is always dark: it is the in-car
app. So every web change is checked in both themes; a phone change only in dark.

**Type.** Geist for everything, Geist Mono for codes and keys. Web: `font-sans` is `Geist Variable`
via fontsource. Phone: each weight is its own family (`font-sans`, `font-sans-medium`,
`font-sans-semibold`, `font-sans-bold`, `font-mono`). Page titles are `text-2xl font-semibold
tracking-tight`; body is the default size; secondary text is `text-sm text-muted-foreground`;
numbers that line up get `tabular-nums`.

**Shape.** `--radius: 0.625rem` (10 px). shadcn's scale derives `sm` 6, `md` 8, `lg` 10, `xl` 14,
`2xl` 18 from it; the phone mirrors the same pixel values. Cards are `rounded-xl` with a 1 px
`border`. Nothing has a shadow, gradient or outline-only button beyond what shadcn ships.

**Spacing.** 16 between cards and inside a card's padding, 8 between related rows. The phone's
`Screen` lays content in a 16-padded column with 16 between cards; a tappable row is 56 dp.

**Icons.** `lucide-react` on the web, at 16 px inside buttons and menus. A single-action row is a
plain button with an icon and a label; two or more actions go into `RowMenu` (the "..." menu).

**Components.** shadcn/ui, installed by its CLI into `apps/web/src/components/ui/` (do not edit
those files; add new ones with the CLI). Everything above that layer is in `apps/web/src/ui/` and
`apps/phone/src/ui/`. The port of Comma's styling was rejected; never copy fonts, layout or CSS
from the Comma web app.

## How to build a web page

1. Start with `PageHeader`: the title, one line of context, and the page's actions on the right.
2. Group content in `Section` cards. Give a `Section` a `label` when tests or screen readers need to
   find it by name. `bare` drops the card for a section inside another card.
3. Figures go in `StatCard` (one figure, its label, an optional line under it); lists in a
   `TableBox` with `tableClass` on a plain `<table>`, or in a card list with `RowMenu` per row.
4. An empty list says what it is and what to do next, in `EmptyState`; never an empty table.
5. Forms are inline on the page (as "Add expense" and "New vehicle" are), built from `Field`,
   `DateField`, `TimeField`, `Picker` or `SelectField`, with `FormError` under the form. A dialog is
   for a confirmation or a short, dangerous step (the new recovery key), not for a form.
6. Lists longer than one page end with `ShowMore` (`usePagedList` in `apps/web/src/api/paged.ts`).
7. Data comes through TanStack Query (`apps/web/src/api/query.ts`): reads with `useApiQuery`,
   every write with `useChange()`, which gives `{ run, busy, error, setError }`. `run((api) =>
   api.POST(…))` never throws; after a change succeeds every cached read is asked again, so a page
   keeps no list of what to refresh. The form's one error line is `errorText(change, ...reads)`.
   Settings are read with `useSettings()` and changed only with `run(...settingsPatch(p))`.
   Money is in minor units of the instance currency, dates in the instance time zone, never the
   browser's. Use the helpers.
8. Check light and dark, a 360 px wide phone browser and a desktop. Then write the test next to the
   page's existing tests (`apps/web/test/*.test.tsx`): they find things by role and name, so give
   controls real names.

## How to build a phone screen

1. Wrap it in `Screen` (back button, title, optional description, 16-padded column).
2. Cards hold `Rows` of `ListRow` (56 dp, accent on press) under a `SectionLabel`.
3. Inputs are `Field`. Short messages go through `useToast`, never pushed into the layout, and a
   toast that reports a problem carries one follow-up action ("Fix permissions", "View shift") so it
   is never a dead end. Anything hard to undo asks first with `useConfirm`.
4. The phone is dark only; colours come from `PALETTE` in `apps/phone/src/theme/colors.ts` when a
   class name cannot reach (icons, the navigator); `test/tokens.test.ts` fails if that mirror drifts
   from `global.css`.
5. The owner tests on a real device; you cannot. Say what is untested.

## Rules that are easy to break

- One primary action per screen. Everything else is `outline`, `ghost` or a link.
- Green means money in, red means money out or danger. Do not use them for status ("synced",
  "ok"); say the status in words, with `muted-foreground` text or a badge.
- No hex colours in components. Use the tokens; if a token is missing, add it to `index.css`,
  `global.css` and `colors.ts` together and extend the tokens test.
- Chart marks and icons that carry meaning need 3:1 against their background; text 4.5:1.
- Every chart has a text alternative (a table, visually hidden until "Show as a table"). See
  `HourBars` for the pattern.
- Dates, times, money and distance always come from the formatting helpers, in the driver's
  settings, never from `toLocaleString()` on its own.
- A measurement that is not computed yet shows a dash, never 0.
- Write for a driver at the end of a shift: short sentences, plain words, no jargon, no exclamation
  marks. The voice reference has the patterns and the words to avoid.

## Delivering a design, not code

When asked for a design file, mockup or wireframe rather than a build: produce an HTML page (an
Artifact if available) that imports nothing but uses these exact tokens, Geist from Google Fonts
or the fontsource import, the radius scale and the primitives' shapes, in both themes. State the
token behind every colour. Keep it to the screens asked for; this system has no decorative layer
to show off.
