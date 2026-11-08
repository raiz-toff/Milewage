# 27 — The web app as an installable app (PWA)

**Status: plan and build, 2026-11-08.** Owner request: "work on the PWA App setup and fix and
check for everything related to pwa so everything is organized and stable for any kind of pwa also
install pop up and all other industry standards". Built as PW1 (manifest, icons, head tags, Caddy),
PW2 (service worker, update prompt, offline notice) and PW3 (install prompt in the sidebar and in
Settings). The logo is not decided (memory: brand palette); every icon comes from one picture
(section 4.1), so the real logo is a one-file swap.

## 1. What was there before (audit, `pr-W9-replay-slider`)

- No manifest, no icons at all (not even a favicon: `/favicon.ico` was a 404 through Caddy), no
  `theme-color`, no Apple tags, no service worker, no install prompt. `index.html` had only the
  title and a viewport with `viewport-fit=cover`, but nothing used `env(safe-area-inset-*)`, so an
  installed app on a notched iPhone in landscape would draw under the notch.
- Caddy served only the screens of `screens.tsx`, `/assets/*` and the API; any other file in the
  build was a 404.
- The planned CSP (`08` response headers row, not set yet) already allows what a PWA needs:
  `default-src 'self'` covers the manifest and `worker-src 'self' blob:` the service worker.
- Every API answer is `Cache-Control: no-store` (server), so nothing private is stored by the
  browser's HTTP cache; the service worker must keep it that way (section 4.2).

## 2. Standards checked

- web.dev [Learn PWA](https://web.dev/learn/pwa/) and Chrome's
  [install criteria](https://web.dev/articles/install-criteria): https (or localhost), a manifest
  with `name` or `short_name`, 192 px and 512 px icons, `start_url`, `display` of `standalone`,
  `fullscreen`, `minimal-ui` or `window-controls-overlay`, `prefer_related_applications` not
  `true`, and some user engagement. A service worker is no longer required by Chrome to install.
- MDN [Web app manifest](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest)
  members: [`id`](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id),
  `start_url`, `scope`, `display`, `theme_color`, `background_color`,
  [`icons` and `purpose`](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons)
  (`any`, `maskable`, `monochrome`), `shortcuts`, `categories`, `screenshots`; the manifest is
  served as `application/manifest+json`
  ([W3C Manifest, media type](https://www.w3.org/TR/appmanifest/#media-type-registration)).
- Maskable icons: the safe zone is the centre circle of 80 % of the width
  ([web.dev, maskable icons](https://web.dev/articles/maskable-icon)).
- Chrome's [richer install UI](https://web.dev/articles/web-apps/richer-install-ui): `description`
  plus `screenshots` with `form_factor` `wide` (desktop) or `narrow` (mobile), 320–3840 px, at most
  2.3 : 1, PNG or JPEG. Optional; not built (section 6).
- The install prompt: [`beforeinstallprompt`](https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent)
  (Chromium only: Chrome, Edge, Samsung Internet, Opera), `appinstalled`, and web.dev's
  [patterns for promoting PWA installation](https://web.dev/articles/promote-install) (do not
  prompt on load; offer it in a place the user expects, such as a menu or settings; let it be
  dismissed and remember that) and [how to provide your own in-app install experience](https://web.dev/articles/customize-install).
- Detecting an installed app: [`display-mode` media feature](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/display-mode)
  and Safari's `navigator.standalone`.
- Safari: [WebKit in Safari 26](https://webkit.org/?p=16993)
  (iOS 26 opens every Home Screen site as a web app; the manifest's icons and `display` are used
  when present), [Add to Dock on macOS Sonoma](https://developer.apple.com/documentation/safari-release-notes/safari-17-release-notes)
  (File › Add to Dock), [`apple-touch-icon`](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)
  (180 × 180, opaque: iOS rounds the corners and shows transparency as black). No
  `beforeinstallprompt` on Safari, so the app shows the steps instead.
- Firefox: Android installs from the menu (Add app to Home screen); Firefox 143 on Windows added
  [web apps as "taskbar tabs"](https://www.omgubuntu.co.uk/2025/09/firefox-143-release-key-changes);
  no `beforeinstallprompt` anywhere.
- Service worker: [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) 2.0.0 (released
  2026-10-03) on [Workbox 7](https://developer.chrome.com/docs/workbox) `generateSW`, with
  [prompt for update](https://vite-pwa-org.netlify.app/guide/prompt-for-update) and the
  [React hook](https://vite-pwa-org.netlify.app/frameworks/react); Workbox
  [precaching](https://developer.chrome.com/docs/workbox/modules/workbox-precaching) and
  [navigation fallback](https://developer.chrome.com/docs/workbox/modules/workbox-routing#how-to-register-a-navigation-route);
  [The service worker lifecycle](https://web.dev/articles/service-worker-lifecycle) (a new worker
  waits until every tab is closed unless it is told to skip waiting; reloading after
  `skipWaiting` is what keeps one version per page); the HTTP cache must not keep `sw.js`
  ([fresher service workers](https://developer.chrome.com/blog/fresher-sw): since Chrome 68 the update check skips the HTTP cache for `sw.js` itself, but `no-cache` keeps older browsers and proxies right too).
- Secure context: service workers and `beforeinstallprompt` need https or localhost
  ([MDN secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts));
  `navigator.serviceWorker` does not exist on plain http.
- [Safe areas](https://developer.mozilla.org/en-US/docs/Web/CSS/env) (`env(safe-area-inset-*)`
  with `viewport-fit=cover`) and the [`theme-color` meta with `media`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/theme-color).
- Lighthouse removed its PWA category in v12 (2024); Chrome DevTools › Application › Manifest
  lists install errors and is the check to use now
  ([Lighthouse 12.0 release notes](https://github.com/GoogleChrome/lighthouse/releases/tag/v12.0.0)).

## 3. Platforms: what the driver gets

| Browser | Install | MileWage shows |
| --- | --- | --- |
| Chrome, Edge (Windows, macOS, Linux, ChromeOS) | `beforeinstallprompt`; also the install icon in the address bar | "Install MileWage" card in the sidebar and Settings › App on this device, which open the browser's install dialog |
| Chrome, Samsung Internet (Android) | `beforeinstallprompt` (installs a WebAPK) | the same card and button |
| Safari, any browser on iPhone and iPad | Share › Add to Home Screen (iOS 16.4+ in every browser) | the card with those steps |
| Safari on macOS 14+ | File › Add to Dock | the card with those steps |
| Firefox on Android | menu › Add app to Home screen | the steps in Settings only |
| Firefox on desktop | Windows: "Add tab to taskbar"; elsewhere none | Settings says which browsers install apps |
| Any browser on `http://<LAN address>` | not possible (not a secure context) | no card; Settings says to open the https address |
| Already installed (`display-mode: standalone`) | — | no card; Settings says it is installed |

## 4. Design

### 4.1 Manifest, icons and head tags (PW1)

- `apps/web/public/manifest.webmanifest`, a static file (the plugin's generated manifest is off,
  so there is one place to read): `id` `/`, `start_url` `/` (the auth shell decides: setup,
  sign-in, onboarding or the dashboard), `scope` `/`, `display` `standalone`, `theme_color` and
  `background_color` the light page colour `#f5f6f8` (light is the web default), categories,
  shortcuts to Shifts and Expenses, and the icons below.
- **One picture, one script.** `apps/web/icons/source.png` (1024 × 1024, opaque, mark inside the
  80 % circle) and `apps/web/icons/generate.py` (Pillow) write: `icons/icon-{192,512}.png`
  (`any`, round corners, shown as they are on desktops), `icons/maskable-{192,512}.png` (full
  bleed; Android cuts its own shape), `icons/monochrome-512.png` (the mark only, alpha), 
  `apple-touch-icon.png` (180, opaque) and `favicon.ico` (16, 32, 48). To change the logo: replace
  `source.png`, run the script, commit. Today `source.png` is the phone app's placeholder mark
  (Lane yellow on Asphalt), so the phone app and the installed web app look the same.
- `index.html`: description, manifest link, icon links, two `theme-color` metas (light and dark
  page colours, by `prefers-color-scheme`), `apple-mobile-web-app-title`,
  `mobile-web-app-capable` and `apple-mobile-web-app-capable`, status bar style `default`.
  `theme.ts` sets both metas to the theme picked in the app, since that choice wins over the OS.
- Caddy: `/manifest.webmanifest` with `Content-Type: application/manifest+json` (Go's MIME table
  has no `.webmanifest`) and `Cache-Control: no-cache`; `/favicon.ico`, `/apple-touch-icon.png`,
  `/icons/*` with one day of caching (not hashed names, so not `immutable`).

### 4.2 Service worker (PW2)

- `vite-plugin-pwa` 2.0.0, `generateSW`, `registerType: 'prompt'`, `injectRegister: false` (the
  React hook registers it), `manifest: false` (4.1's file), Workbox runtime inlined so there is
  one file, `/sw.js`.
- **Precache the app shell only:** `index.html`, the hashed JS and CSS, fonts, icons and the
  manifest. Not the MapLibre worker (fetched with a `?v=` query; the map needs the network for
  tiles anyway).
- **No runtime caching at all.** `/api/*` and `/healthz` never go through a cache: requests that
  are not precached fall through to the network untouched, and API answers stay `no-store`.
- **Navigation fallback** to the precached `index.html` for in-app routes, with `/api/` and
  `/healthz` on the deny list (an APK or export download is a navigation and must reach the
  server).
- `cleanupOutdatedCaches` on (vite-plugin-pwa: "strongly recommend you NOT deactivate").
- Development: no service worker (`devOptions` off), so `npm run dev` never serves a stale build.
- Caddy: `/sw.js` with `Cache-Control: no-cache`, so the browser always asks for the newest one,
  and `/index.html` by name (the worker precaches it by that name; before PW2 only the screens'
  paths served it, so `/index.html` was a 404 and the worker would never have installed).
- Workbox `mode: 'production'` whatever `NODE_ENV` says (minified, no dev logging).

### 4.3 Update flow (PW2)

A new deploy installs a new worker in the background, which then **waits**. MileWage shows a
small card, bottom right (role `status`): "A new version of MileWage is ready." with **Reload**
and **Later**. Reload tells the waiting worker to skip waiting and reloads the page once it takes
control, so one page never mixes two versions. Later hides it until the next visit. The page asks
for a new worker every hour while it is open (the vite-plugin-pwa recipe) and the browser also
checks on every navigation. No "ready to work offline" message: it says nothing a driver needs.

### 4.4 Install prompt (PW3)

- `src/pwa/install.ts`: one small store. At start-up (`main.tsx`, before React, since the event
  can fire early) it listens to `beforeinstallprompt` (keeps the event, calls `preventDefault()`
  so Android's mini-infobar does not pop up on its own) and `appinstalled`. It reports one state:
  `installed`, `prompt` (the browser can show its dialog), `ios`, `safari-mac`, `firefox-android`,
  `insecure` or `unsupported`.
- **Sidebar card** (shadcn `Card` in the sidebar footer, above the system links; hidden when the
  sidebar is collapsed to icons): "Install MileWage — Open it from your dock or home screen, in
  its own window." with **Install** (or the Safari steps) and a close button. It shows only for
  `prompt`, `ios` and `safari-mac`, never when installed or on http, and **Not now** is
  remembered in `localStorage` (`mw-install-dismissed`), so it never comes back by itself.
- **Settings › App on this device**: always there; says whether MileWage is installed, offers
  the Install button, or the steps for the browser, or why it cannot install here.
- Nothing pops up on load; the browser's own dialog opens only from a click.

### 4.5 Offline

The service worker opens the app without a network, but every screen reads the server. When the
server cannot be reached the shell says so plainly ("You are offline" when the browser knows,
else "The server could not be reached"), with **Try again**, instead of a blank page. No data is
kept for offline use (privacy: no shift or money data in caches).

### 4.6 Installed window and safe areas

`viewport-fit=cover` stays (the background fills the whole screen); `body` gets
`env(safe-area-inset-left/right/bottom)` padding and the fixed desktop sidebar moves by the left
inset, so nothing sits under a notch or the home bar. With status bar style `default` iOS keeps the
page below the status bar.

### 4.7 Plain http on the LAN

Over `http://192.168.x.x` browsers allow no service worker and no install prompt. The app works
as a website: registration is skipped (the `serviceWorker` check fails quietly), the sidebar card
never shows, and Settings says "Browsers install apps only from an https address. Open MileWage
at its https address (for example through Tailscale, plan 19) to install it." `localhost` is a
secure context, so development keeps working.

## 5. PRs

| PR | What |
| --- | --- |
| PW1 | This plan; manifest, icons and the generator, head tags, theme-color sync, safe areas, Caddy headers, smoke checks |
| PW2 | vite-plugin-pwa service worker, update card, offline notice with Try again, Caddy `/sw.js` |
| PW3 | Install store, sidebar card, Settings › App on this device |

## 6. Not done, and why

- **Screenshots for the richer install dialog**: they would show made-up data and go stale with
  every UI change; the plain dialog works. Add them when the UI settles (owner decision).
- **iOS launch images** (`apple-touch-startup-image`): one image per device size and orientation
  (dozens); iOS shows the page background colour without them.
- `display_override` / Window Controls Overlay, `launch_handler`, share target, file handlers,
  push and background sync: no feature asks for them.
- Offline data (reading shifts without a connection): a privacy and correctness cost for little
  gain on a dashboard; the phone app is the offline recorder.

## 7. Owner to confirm

1. The icon is the phone's placeholder mark until a logo is chosen (swap: section 4.1).
2. Name "MileWage" for both `name` and `short_name`.
3. Window colour: the light page colour by default, the dark one when the dark theme is chosen.
4. Dismissing the sidebar card is permanent; Settings keeps the button.
