# :data (and the API, connection and pairing code in :core)

Storage, the server connection, secure storage and (later) sending. The logic that is not Android
lives in `:core` so it runs on the JVM in tests and can become Kotlin Multiplatform code:
`app.milewage.core.api` (models, encoder, client), `app.milewage.core.connect` (home or away,
discovery, messages) and `app.milewage.core.pairing` (codes, links, credential, device session).
`:data` holds the Android adapters. Each is a port of the Expo app's code (`apps/phone/src/...`)
and its tests carry the Expo tests' cases.

## The API client

- `ApiClient` (`:core`) is the port of `apps/phone/src/api/client.ts`. It runs over the
  `HttpTransport` port; `OkHttpTransport` (`:data`) implements it on the client from
  `HttpClients.create(anyHttp)`. Calls are typed by the endpoint table `Api` (`Endpoints.kt`):
  `client.call(Api.settings)`, `client.call(Api.redeem, RedeemRequest(...))`.
- Every request carries `Accept`, `X-Client-Time` and, once paired, `Authorization: Bearer mwd_...`.
  The client never logs; exception messages hold only the status and the code.
- Failures are one type, `ApiException(status, code, retryable, retryAfterS, problem)`, with
  `failure: ApiFailure` for the screens and senders (unreachable, insecure address, wrong server,
  not MileWage, revoked, unauthorised, app too old (426), API version unsupported, read-only,
  restoring, server full, rate limited, invalid code, link expired, ...). The phone's own codes are
  in `ApiCodes` (`network`, `bad_response`, `insecure_address`, `wrong_server`, `not_milewage`,
  `api_unsupported`); the rest are the server's Problem codes.
- Shift changes are built once by `ShiftRequests.encode(ShiftChange)` (the port of
  `sync/shiftRequests.ts`) and sent with `client.send(request)`; an outbox row
  (`kind`, `entityKey`, `body`) gives the same request back with `ShiftRequests.requestFor`.
  Point batches and diagnostics go gzipped.

## The contract: how drift is caught

`packages/shared/openapi/openapi.yaml` is the contract. The Kotlin models (`Models.kt`) are written
by hand and `ContractDriftTest` (`:core:test`) fails when they and the spec disagree. It reads the
YAML from the repository and checks, for every operation in `Api.all`:

1. the path and method exist with the same `operationId`;
2. the request and response models match their schemas field by field (`DescriptorCheck`): every
   Kotlin field exists under the same wire name with the same JSON type; a request model writes every
   field the spec requires and only enum values it allows; a response model needs only fields the
   spec requires, is nullable where the spec allows null, and knows every enum value;
3. a contract-valid answer for every status the phone reads (`ContractFixtures`) validates against
   the spec (JSON Schema 2020-12, networknt json-schema-validator) and decodes with the model;
4. what the phone sends validates against the request schema (`ShiftRequestsTest` for every shift
   change and the point batch, `ContractDriftTest` for pairing, linking and diagnostics).

Why not generated: OpenAPI Generator 7.27 (kotlin, kotlinx_serialization) was tried on this spec.
`EpochMs` has no `format: int64`, so every timestamp came out as `Int` (it overflows); enums came out
`@Contextual`, uuids and dates as `java.util.UUID`/`java.time.LocalDate` (not multiplatform), and
its OpenAPI 3.1 support is labelled beta (it also rejects the spec's YAML without
`--skip-validate-spec`). Hand-written models with this two-way check catch the same drift.

When the spec changes:
1. Run `./gradlew :core:test`. The failures name each field and operation.
2. Update the answer in `src/test/.../support/ContractFixtures.kt` if an answer changed, then the
   model in `Models.kt` (and `Endpoints.kt` for a new or moved operation; a new operation needs a
   fixture per status).
3. Model rules: integers are `Long`; enums the phone sends or branches on are Kotlin enums, enums it
   only shows are strings (a newer server may add values); response fields an older server lacks get
   defaults.

One spec quirk is handled in the check: `ManualTripPut` is `allOf: [TripCreate, {edited_at}]` and
TripCreate says `additionalProperties: false`, which strict JSON Schema reads as "edited_at is not
allowed". The server validates its own merged object, so the check merges `allOf` members first.
(`unevaluatedProperties: false` on ManualTripPut would say it in the spec.)

## Connection rules (plan 28)

- **Two addresses.** A credential has a home address (on the home network, plain http allowed) and
  an away address (https, through Tailscale). `RoutePicker` uses home when the phone is on Wi-Fi or
  Ethernet and `GET <home>/healthz` answers within 1.5 s as a MileWage server with the paired
  instance id (`HealthProbe`); otherwise away. On mobile data it does not try home. The choice is kept
  for a minute and dropped when a request gets no answer. On Wi-Fi with a silent home address it
  looks (at most every 10 minutes, in the background) for the same instance on the Wi-Fi and keeps its
  new address (`Pairing.updateHome`, home addresses only).
- **Plain http only to a home address.** `ApiClient` refuses before building anything, and
  `HomeOnlyCleartext` in OkHttp refuses every hop, redirects included. The home address stored at
  pairing is always a home address (`HomeAddress`), so it passes the gate; a server's answer cannot
  store anything else (home must be a home address, away must be https outside it).
- **Identity on every answer.** An answer naming another `X-MileWage-Instance` than the paired one
  halts the device session (`WRONG_SERVER`): nothing is sent until the driver re-pairs. An answer
  without the header (a captive portal) is not a wrong server. Every other answer goes to
  `PairingDeps.onAnswer` with its restore generation, for the sending task's restore check.
- **Discovery.** `NsdDiscovery` browses `_milewage._tcp` with the platform NsdManager for 4 s and
  resolves each service (`registerServiceInfoCallback` on Android 14+, `resolveService` before).
  `Discovery.serversFrom` keeps record version 1 on home addresses only. Older phones (before
  T extensions 7) need a Wi-Fi multicast lock to receive mDNS: `CHANGE_WIFI_MULTICAST_STATE`
  (normal, no prompt) is in the manifest and the policy list; the lock is held only while browsing.
- **Android 17.** At targetSdk 36 local network access comes with INTERNET and the platform docs
  say not to declare `ACCESS_LOCAL_NETWORK`. When targetSdk becomes 37 it is a runtime permission
  (NEARBY_DEVICES group) for discovery and for any connection to the home address: add it to the
  manifest and the policy list, and ask before discovery or a home request while
  `AndroidNet.localNetworkPermissionNeeded()` is true.
- **Messages.** `Reach.addressProblem` (before connecting) and `Reach.explainFailure` (after) return
  types, not words; each case's KDoc has the Expo app's English for strings.xml.

## Pairing flows

- **Code** (QR, pasted text, `milewage://pair?...` link, or the https page link
  `<server>/pair#v=1&t=...`): `PairingLinks.parse(text)` then `pairing.redeem(link)`. With a home
  address in the code the phone redeems at home when it answers on the Wi-Fi, else at the code's
  address. Check `Reach.addressProblem(link.baseUrl, release)` first. A link that opens the app goes
  through `IncomingLinks.accept` (once per link) and `IncomingLinks.decide` (already paired: say so,
  never switch servers silently).
- **Link code on the home Wi-Fi**: `net.discover()`, then `pairing.startLink(server.url)` (show
  `userCode`), then `pairing.awaitLink(url, start)` (polls at the interval, slows down on
  `slow_down`, throws `link_expired`), or `pollLink` one at a time.
- **Storage.** The credential (`Credential`, with the token) is JSON in the Keystore-backed
  `SecretStore` under `pairing.credential`; the cached settings, the setup flag and a stored revoke
  are in the `pairing` DataStore file. A credential the Keystore can no longer open reads as
  "not paired".
- **Revoked, refused, another server.** `DeviceSession` holds the halt every sender obeys:
  `REPAIR` (401 `device_revoked`, kept across restarts; `pairing.status()` is `REVOKED`),
  `WRONG_SERVER` (blocks every request), `AUTH_PROBLEM` (other 401/403). Pairing again lifts every
  halt; so does `device.resume()` ("Send now", "Check the address").
- **Unpair**: `pairing.unpair(waiting = { unsent data exists })` refuses while data waits; pass
  `{ false }` after the driver confirms losing it.

## QR codes

`QrDecoder` reads a QR code from a luminance frame with ZXing (`com.google.zxing:core`, plain Java,
no Google services). `QrFrameAnalyzer` is the CameraX `ImageAnalysis.Analyzer` (Y plane of the
default YUV_420_888 output) with `ScanGate`. The scan screen adds `camera-camera2`,
`camera-lifecycle` and `camera-view` (or `camera-compose`) in `:app`, binds a Preview and an
`ImageAnalysis` (`STRATEGY_KEEP_ONLY_LATEST`) with this analyzer, and asks for CAMERA only then.
