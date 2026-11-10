# Material Design 3 on the web and on Android, from one generated scheme; the web restyled in place

On 2026-11-06 the owner chose shadcn/ui components and the MileWage palette for the phone and the web. On 2026-11-10 the owner decided that both move to Google's Material Design 3, so the web app and the new native Android app look and behave alike. We decided:

- **One colour scheme, generated, not hand-picked.** `apps/web/scripts/m3-theme.mjs` generates every Material colour role from Lane yellow `#FFC21F` with Google's material-color-utilities (the Fidelity variant, 2021 spec, standard contrast), and `earned` and `spent` as extended colours harmonised with it. It writes `apps/web/src/theme/m3-scheme.css` for the web and `m3-scheme.json`; the Android app generates `BrandColors` with the same library and settings, and `BrandSchemeTest` (`apps/android/app/src/test/.../ui/theme/`) fails when the two differ. `apps/web/test/m3-contrast.test.ts` holds the roles to 4.5:1 for text and 3:1 for marks, light and dark.
- **The web is restyled in place.** The existing components in `apps/web/src/components/ui` (copied from shadcn/ui, on Radix primitives) keep their markup, accessibility and tests and take Material's tokens: Roboto Flex on the Material type scale, Material shape, elevation and motion, a state layer and ripple (`components/ui/ripple.ts`), and Material Symbols instead of lucide (bundled, nothing fetched). Pages did not change their structure.
- **Android uses Jetpack Compose Material 3** directly, with the house composables in `ui/components`.
- The design guide (`.claude/skills/milewage-design`) describes both and is the reference for new screens.

## Considered options

- **MUI**: rejected. Its components implement Material Design 2; Material 3 is not in a released MUI version, so it would have been a full rewrite of every page onto a library that still looks like the old Material.
- **Material Web (`@material/web`), Google's own web components**: rejected. Google put it in maintenance mode in 2024, with no new components planned; a new dependency on it would age badly, and its web components fit a React app poorly.
- **No other maintained official Material 3 library for React exists**, so restyling the components we own was the smallest change that gives the real Material 3 tokens.
- **A hand-made palette for each platform**: rejected; two palettes drift, and a generated scheme gives correct tonal pairs and contrast in light and dark for free.

## Consequences

- This replaces the 2026-11-06 decision on the look (shadcn/ui with the MileWage palette). shadcn/ui remains only as the origin of the web's component code, which MileWage now owns and edits.
- A change of the brand colour is one change to the seed, regenerated on both sides; the Android test catches a scheme that was regenerated on one side only.
- Colours in screens and pages come from roles only, never a hex value (the design guide's rule, and the Android README's).
