# The Help switch is a server-stored owner setting, not a browser preference or a module

The owner must be able to hide the Help pages, which are on by default (2026-11-09). We store the choice on the server as `settings.help_enabled` (a `core` migration, a boolean in the OpenAPI `Settings` and `SettingsPatch`), shown in Settings > Help pages and saved with the other preferences, so it follows the owner to every browser and survives a cleared cache or a new device.

## Considered options

- **A browser-local preference**, as the theme is: the theme depends on the device, but knowing the app does not; a per-browser switch would come back on in every other browser and after every cache clear.
- **A server module in config** (`MILEWAGE_*`), listed under Settings > Server modules: an operator choice that needs a config edit and a restart, and that list is read-only in the app.
- **An effective flag `modules.help`**, copying `modules.stops`: rejected because Help has no server part; `Modules` describes what the server runs, and the phone caches those flags. The web derives its screen rule instead (`screenFlags(settings)` adds `help` beside the module flags).

## Consequences

- The column is permanent: migrations are forward-only and never edited after release.
- When settings cannot be read (the server is unreachable at start), the switch is unknown, so v1 shows no Help on that screen. Any later offline Help must decide how it honours the switch without a browser-local copy.
