# The server is assembled once: registry and bus first, then each module wires itself

A MileWage server is built by one function, `assembleServer` (2026-11-09), which both the production start-up and the test harness call. It builds the module registry from the static module list and creates the in-process event bus before anything else, then the services several modules share, then asks each module that is switched on to wire itself from one typed host and return its routes, jobs and event subscriptions. A module that is off is never constructed. We chose this over the earlier layout, in which one long function wired every module by hand, the bus and registry reached modules only when their routes were registered, and the test harness kept its own copy of the wiring, because that layout silently dropped events whenever the tracking module was off (a failed backup never reached the inbox or diagnostics) and made every new module or option touch four to six files.

## Consequences

- The shared package describes only the module graph (names, dependencies, defaults, switch resolution). What a module does is server code.
- The host every module receives is one wide typed object until the driver-context and earnings work gives some of those services a deeper interface.
- Reversing this would mean re-splitting the wiring between the shared registry and the server.
