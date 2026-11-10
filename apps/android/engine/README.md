# :engine

The Kotlin port of `packages/track-engine`: GPS fixes in, a shift's trips, stops, distance, route,
flags and input digest out. The phone runs it to show a shift before the server confirms it; the
server recomputes every shift with the TypeScript original and compares, digest included. Both
must give the same bytes for the same input, and they do: see "Evidence" below.

## Rules

1. **No platform imports.** Plain Kotlin, the Kotlin standard library and kotlinx.serialization
   (multiplatform) only: no `android.*`, `androidx.*`, `java.*` or `javax.*` in `src/main`, and no
   JVM-only calls such as `Math.floorDiv` or `String.format`, because this module becomes Kotlin
   Multiplatform `commonMain` when the iPhone app arrives. `ModuleRulesTest` fails the build on an
   import; test code may use `java.io` and `java.security`.
2. **Integer arithmetic.** Positions are E7 `Int`s, times are epoch milliseconds in `Long`,
   distances are summed in decimetres in `Long`. Rounding is half up, exactly as `roundHalfUp` and
   `divRound` do it.
3. **Bit for bit with the TypeScript engine.** Same thresholds, same stages, same order, same
   `algorithmVersion`, same doubles where the TypeScript uses doubles. Trigonometry goes through
   `FdLibm`, never `kotlin.math.sin/cos/atan2`.
4. **The TypeScript decides.** The tests read the TypeScript's own fixture files in place and the
   cross-check compares against Node. When the two disagree, the Kotlin is wrong.

## File map

Each Kotlin file names its TypeScript source in its first line. Names are kept parallel
(`processShift`, `gateStep`, `MIN_MOVE_DM`, ...) so a change can be made side by side.

| TypeScript (`packages/track-engine/src/`) | Kotlin (`src/main/kotlin/app/milewage/engine/`)                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `types.ts`                                | `Types.kt` (string unions are enums with `wire` = the TypeScript string)                        |
| `ints.ts`                                 | `Ints.kt`                                                                                       |
| `haversine.ts`                            | `Haversine.kt` + `FdLibm.kt` (V8's `Math.sin`, `Math.cos`, `Math.atan2`)                        |
| `normalize.ts`                            | `Normalize.kt`                                                                                  |
| `qualify.ts`                              | `Qualify.kt`                                                                                    |
| `gate.ts`                                 | `Gate.kt`                                                                                       |
| `gaps.ts`                                 | `Gaps.kt` (also holds `cmp`, the UTF-16 string order)                                           |
| `stops.ts`                                | `Stops.kt`                                                                                      |
| `trips.ts`                                | `Trips.kt`                                                                                      |
| `edits.ts`                                | `Edits.kt`                                                                                      |
| `route.ts`                                | `Route.kt`                                                                                      |
| `digest.ts`                               | `Digest.kt`                                                                                     |
| `canonical.ts`                            | `Canonical.kt` (`CanonicalValue` tree and its writer; `ShiftResult.toCanonical()`)              |
| `process.ts`                              | `Process.kt`                                                                                    |
| `live.ts`                                 | `Live.kt`                                                                                       |
| `version.ts`                              | `Version.kt` (`ALGORITHM_VERSION`)                                                              |
| `index.ts`                                | `Engine.kt` (the facade other modules call)                                                     |
| none                                      | `SelfCheck.kt`: `engineSelfCheck()`, a few Node results the phone can verify on its own runtime |

## Public API

```kotlin
fun processShift(input: ShiftInput): ShiftResult           // the authority (also Engine.processShift)
fun canonicalJson(result: ShiftResult): String              // the bytes the server compares
fun createLiveAccumulator(startedAt: Long): LiveAccumulator // push(fix), runningTotalM(): Long
fun measureDistance(fixes: List<Fix>, startedAt: Long, endedAt: Long): GateResult
fun lastFixEnd(fixes: List<Fix>, startedAt: Long): Long?    // then autoClosed = true
fun inputDigest(input: ShiftInput, normalized: List<Fix>): String
fun degToE7(deg: Double): Int ; fun e7ToDeg(e7: Int): Double
fun haversineDm(aLatE7: Int, aLonE7: Int, bLatE7: Int, bLonE7: Int): Long
fun engineSelfCheck(): List<String>                         // empty = this runtime matches Node
const val ALGORITHM_VERSION: Int                           // Engine.ALGORITHM_VERSION
```

The stage functions (`normalize`, `qualify`, `gate`, `gateStep`, `detectGaps`, `detectStops`,
`estimateRoles`, `stopTrips`, `wholeShiftTrips`, `buildTrips`, `applyEdits`, `simplifyRoute`,
`sortFlags`, ...) and every constant are public as in `index.ts`. The models (`Fix`, `ShiftInput`,
`ShiftResult`, `Trip`, `Stop`, `Flag`, `TripEdit`, `StopLabelInput`, ...) are `@Serializable` with
the TypeScript field and string names, so JSON to and from the server maps one to one. The
canonical form is written by `Canonical.kt`, never by a JSON library.

Types: `seq`, times, durations and distances are `Long`; `latE7`, `lonE7`, `accuracyM` are `Int`
(the server accepts |latE7| <= 9e8 and |lonE7| <= 1.8e9; an accuracy above 2^31 m is not a real
reading). The TypeScript's optional lists are empty lists (every stage treats both the same).
An explicit JSON `null` for `purpose` or `kind` is treated as absent; the TypeScript types do not
allow null and the server's schema rejects it.

## Exactness

Each place where JavaScript and Kotlin could disagree, how it is settled, and its test
(`ExactnessTrapsTest` unless named; vectors from Node in `src/test/resources/trap-vectors.json`).

| Trap                                                            | Settled by                                                                                                                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Numbers are doubles in JavaScript                               | Every engine value stays below 2^53, where a double is an exact integer, so `Long` gives the same numbers. Products that could pass 2^31 (`dDm * 1000`, `420 * dtMs`, `accuracy * 10`, longitude differences) are `Long`.            |
| `Math.floor(x + 0.5)` vs `kotlin.math.round` (half to even)     | `roundHalfUp` is `floor(x + 0.5)`. Test with halves, negatives and `0.49999999999999994`.                                                                                                                                            |
| `Math.floor(a / b)` vs Kotlin `/` (truncates) on negatives      | `floorDiv` in `divRound`, `dmToM`, `dt_s=` and `dwellS`. Exact while `2 * num + den` < 2^53. Test with negative numerators.                                                                                                          |
| Subtraction comparators (`a.lonE7 - b.lonE7`) overflow an `Int` | `compareFixes` compares field by field. Test with longitudes +-180 degrees.                                                                                                                                                          |
| Route projection: `(lon - lon0) * cosQ`                         | Difference in `Long` (an antimeridian route exceeds `Int`), product exact below 2^53, then the same double operations in the same order. Test with antimeridian and polar routes.                                                    |
| String `<` is UTF-16 code unit order                            | `cmp` uses `String.compareTo`, which compares UTF-16 chars on every Kotlin platform (not code points). Test with an emoji against U+FF5E.                                                                                            |
| Sorting by a union's string, not its position                   | Enums carry `wire`; `sortFlags`, `sortEdits`, label order and the digest compare `wire`, never ordinals. Tests: flag order, label `pickup` vs `dropoff`.                                                                             |
| `Array.prototype.sort` is stable (TimSort in V8)                | `sortedWith` is stable on every Kotlin platform. Test with two fixes equal in every compared field.                                                                                                                                  |
| `Map`/`Set` insertion order                                     | `LinkedHashMap` for the label map (re-setting a key keeps its position, as in JavaScript); the other sets are only membership tests. Test: orphaned-label order.                                                                     |
| `${number}` in keys, details and the digest text                | `Long.toString` prints an integer below 2^53 exactly as JavaScript does (no `-0` exists in `Long`; 1e21 is out of range).                                                                                                            |
| `JSON.stringify` of strings in the canonical form               | Own writer: `\"`, `\\`, `\b\t\n\f\r`, other controls and lone surrogates as lowercase `\u00xx`, everything else raw (DEL, U+2028/9). Test against Node on 15 awkward strings.                                                        |
| Canonical numbers                                               | Integers only, `RangeError` for unsafe integers becomes `IllegalArgumentException`. Keys sorted by UTF-16 code unit, absent members omitted.                                                                                         |
| `inputDigest` hash                                              | 64-bit FNV-1a; the TypeScript's two 32-bit halves on doubles are exactly multiplication mod 2^64, so `ULong` arithmetic. Bytes per UTF-16 unit: one below 0x80, else low then high (not UTF-8). Tests: 15 strings and a digest text. |
| `toFixed`, `\|0`                                                | Not used by the engine (`toFixed` is only in the Expo harness; `>>> 0` only in the digest, replaced by `ULong`).                                                                                                                     |
| `Math.sin`, `Math.cos`, `Math.atan2`                            | `FdLibm.kt`, see below.                                                                                                                                                                                                              |

### Floating point

`haversine.ts` computes `6371000 * 2 * atan2(sqrt(a), sqrt(1 - a)) * 10` and rounds once to
decimetres; `route.ts` takes one `cos`. `+ - * /` and `sqrt` are correctly rounded by IEEE 754 on
every platform, so the only freedom is in `sin`, `cos` and `atan2`, which no standard pins to the
last bit. One bit can move a distance across a half decimetre.

What Node runs: Node v22.22.0 (the server image pins it) is built without
`V8_USE_LIBM_TRIG_FUNCTIONS` (its `tools/v8_gypfiles` never define it, and `--use-libm-trig-functions`
does not exist in `node --v8-options`), so `Math.sin`, `Math.cos` and `Math.atan2` are V8's fdlibm
port in `deps/v8/src/base/ieee754.cc`. `FdLibm.kt` ports those functions line for line
(`sin`, `cos`, `atan`, `atan2`, `__ieee754_rem_pio2`, `__kernel_rem_pio2`, `__kernel_sin`,
`__kernel_cos`), constants written as bit patterns and checked against V8's decimal values. It uses
only `+ - * /`, `floor`, truncation to `Int` and bit casts, all exact on the JVM, ART and Kotlin/Native.
The JVM's `kotlin.math` is not used: on HotSpot it calls CPU intrinsics that differ from V8.

Evidence (`./gradlew :engine:test` with the generated files present, 2026-11-10):

- `FdLibmTest`: 900,195 calls of sin, cos and atan2 over every range (the haversine's, tiny,
  next to multiples of pi/4, medium, up to 1e300, random bit patterns, NaN, infinities,
  subnormals) are **bit-identical to Node**. `kotlin.math` on the JVM differs on 40,899 of them.
- `HaversineCrossCheckTest`: 250,000 coordinate pairs (short hops of 1 to 100 m, sub-metre, city
  distances, anywhere to anywhere, latitudes above 80 degrees, across the antimeridian, across the
  equator, near-antipodal, and the poles and Int extremes): the raw double before rounding has
  **the same 64 bits as Node on all 250,000**, so the decimetres are equal. The same formula on
  `kotlin.math` differs in the raw double on 5,314 pairs and in decimetres on 9 (all near-antipodal,
  where the formula is ill-conditioned; on real hops the JVM would only rarely differ, but rarely
  is not never).

Residual risk, plainly:

- **ART (Android).** Java semantics forbid fusing a multiply and an add, and ART's compiler
  follows them, so the JVM result should hold on the phone. The tests here run on a desktop JVM,
  not on ART. `engineSelfCheck()` (18 Math results and 11 haversine doubles from Node, including
  the near-antipodal ones) lets the app prove it on the device; wire it into a debug screen or a
  startup log line.
- **Kotlin/Native (iPhone, later).** Kotlin/Native emits plain IEEE operations without the LLVM
  contraction flag, so no FMA should appear. Unverified until the module moves to `commonMain`:
  run the same tests in `iosTest` then.
- **The server's Node.** The truth was measured on Node v22.22.0 on x86-64. Node is built with
  `-std=gnu++17`, where GCC may contract `a * b + c` into a fused multiply-add on targets that
  have one; only s390x and ppc64 builds turn that off. A server on arm64 (Raspberry Pi, Ampere)
  may therefore compute fdlibm's polynomials with FMA and differ in the last bit from an x86-64
  server, and from this port. Not verified here (no arm64 machine). A Node upgrade, or a V8 that
  switches `Math.sin/cos` to glibc's (`V8_USE_LIBM_TRIG_FUNCTIONS`, as Chrome already does), changes
  the truth: re-run the cross-check after every Node bump.
- **Domain.** Inputs are integers in the server's schema ranges. A coordinate outside an `Int`, an
  accuracy above 2^31 m or a non-integer number cannot be decoded; times beyond 2^53 ms are out of
  range on both sides.

## Tests

From `apps/android`: `./gradlew :engine:test`.

| Test                      | What                                                                                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConformanceTest`         | `apps/phone/src/conformance/fixtures.json` (15 inputs, Node's canonical JSON) byte for byte; `golden-shift.json` results and its ledger sha256; `golden.json` stage 1-3 rides and its ledger sha256. Read in place by path. |
| `CrossCheckTest`          | Random shifts from Node: canonical JSON, live total, `lastFixEnd`, `measureDistance`. 100-shift committed sample always; the generated run when present.                                                                    |
| `HaversineCrossCheckTest` | Raw haversine doubles against Node: 3,000-pair committed sample always; 250,000 pairs when generated.                                                                                                                       |
| `FdLibmTest`              | sin, cos, atan2 bits against Node: committed sample always; 900,195 calls when generated. Also `engineSelfCheck()`.                                                                                                         |
| `ExactnessTrapsTest`      | One test per trap in the table above.                                                                                                                                                                                       |
| `ModuleRulesTest`         | No platform imports in `src/main`; `ALGORITHM_VERSION` equals `version.ts`.                                                                                                                                                 |

### Cross-check

The large files are generated into `build/crosscheck/` (gitignored) and the tests skip them with a
`SKIPPED` line when absent. From the repo root, with Node 22:

```sh
npx vite-node apps/android/engine/tools/export-math.ts   # math.txt (900k calls), haversine.csv (250k pairs)
npx vite-node apps/android/engine/tools/crosscheck.ts    # shifts.jsonl: 2,000 random shifts
#   options: -- --shifts 5000 --seed 777 --max-fixes 900
cd apps/android && ./gradlew :engine:test                # the counts are printed in the test output
```

Last run (2026-11-10): 2,000 shifts (911,990 fixes, seed 20261110) and 5,000 shifts (2,319,896
fixes, seed 777): **0 differences**. The shifts mix both segmenters, poor accuracy, accuracies of
21 to 50 m, gaps and teleports, stops of 30 s to 45 min with GPS sleep, duplicate and conflicting
seqs, shuffled and reversed order, fixes outside the window, clock skew, interruptions,
auto-closed shifts, labels (matching, duplicated, orphaned), edits (kind, purpose, duplicated,
orphaned) with emoji, quotes, control characters and lone surrogates, and routes at high latitude,
on the equator and across the antimeridian.

The committed samples in `src/test/resources/` are regenerated (deterministically) with `--sample`:

```sh
npx vite-node apps/android/engine/tools/export-math.ts -- --sample   # math-sample.txt, haversine-sample.csv
npx vite-node apps/android/engine/tools/crosscheck.ts -- --sample    # crosscheck-sample.jsonl (100 shifts)
npx vite-node apps/android/engine/tools/export-traps.ts              # trap-vectors.json
```

## Changing the engine

1. Change the TypeScript first (`packages/track-engine`), with its tests.
2. If any output can change, bump `algorithmVersion` and regenerate its fixtures
   (`UPDATE_FIXTURES=1 npx vitest run golden`) and the phone's (`npm run conformance:fixtures -w apps/phone`).
3. Port the change here, file for file, and set `ALGORITHM_VERSION` (`ModuleRulesTest` fails until
   it matches).
4. Regenerate the samples and the cross-check (commands above), run `./gradlew :engine:test` with
   the generated files present, and report the counts. Same pull request.

After a Node upgrade (the server image), re-run `export-math.ts` and the cross-check even when the
engine did not change; if `Math.sin`, `Math.cos` or `Math.atan2` changed, `FdLibm.kt` must follow
the new V8 code.
