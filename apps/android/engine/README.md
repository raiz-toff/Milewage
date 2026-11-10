# :engine

The Kotlin port of `packages/track-engine`: GPS fixes in, a shift's trips, stops and distance out.
The phone runs it to show a shift before the server confirms it; the server runs the TypeScript
original. Both must give the same answer for the same fixes.

## Rules

1. **No Android imports.** Plain Kotlin and the Kotlin standard library only: no `android.*`, no
   `androidx.*`, and no `java.*` or `javax.*` either, because this module becomes Kotlin
   Multiplatform `commonMain` when the iPhone app arrives. `ModuleRulesTest` fails the build on any
   of them.
2. **Integer arithmetic.** Positions are E7 integers (`latE7`, `lonE7`), distances are summed in
   decimetres, time is epoch milliseconds in `Long`. No floating point decision leaves the helpers
   that mirror `src/ints.ts`. Rounding is half up, exactly as `roundHalfUp` and `divRound` do it.
3. **Bit for bit with the TypeScript engine.** Same thresholds, same stages, same order, same
   `algorithmVersion`. Where the TypeScript uses `Math.sin`, `Math.cos`, `Math.atan2` or
   `Math.sqrt`, the Kotlin port must give the same double for the same input. V8 computes the
   trigonometric functions with a port of fdlibm; `kotlin.math` on the JVM may use faster intrinsics
   that differ in the last bit. Where a floating point step feeds an integer result, use (or port)
   fdlibm so the result is the same on the JVM, on Android and later on iOS, and prove it with the
   golden files.
4. **The golden files decide.** `packages/track-engine/test/fixtures/golden.json` and
   `golden-shift.json` are read by this module's tests (a later task wires them in) and every case
   must match exactly. A change to the TypeScript engine that bumps `algorithmVersion` is ported here
   in the same pull request.

## Build and test

From `apps/android`: `./gradlew :engine:test`.
