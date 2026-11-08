# 26 — MCP server: let the driver's AI assistant read and enter MileWage data

**Status: built, 2026-11-08** (M0–M3 merged; M4–M7 pushed). Install note: `infra/docs/install.md` section 7. Owner request: "I want to have MCP server integrated into
MileWage so user can edit or analyse data or do data entry so easily."

The driver connects an AI client (Claude Code, Claude Desktop, claude.ai, or any other client that
speaks the Model Context Protocol) to **their own** MileWage server. The assistant can then answer
"how much did I make per hour on DoorDash in October?", "which week had the most deadhead?" or
"what will I owe in tax?", and do data entry such as "add a $54.20 fuel expense from Esso today" or
"I forgot a $6 tip on Tuesday's Uber Eats shift".

## 1. Goal and limits

- **Analyse:** read the same figures the web shows (summary, analytics, shifts, trips, earnings,
  expenses, goals, odometer, tax estimate), nothing more.
- **Enter and fix:** add an expense, an earnings entry, an odometer reading or a hand-made trip;
  change a shift's notes or vehicle; correct an expense.
- **Never:** delete the account, change the password, sessions or devices, change MCP tokens,
  read or download backups, read the recovery key or `secrets.json`, run a restore, export files,
  read GPS points or routes, or reach anything outside this server.
- **Off by default** (README section 1.3, the modularity rule), and useless until the owner makes a
  token in Settings.
- **Same rules as the web.** Every tool goes through the existing REST route in process, so the
  validation, business rules, events (`expense.created`, `earnings.changed`, overwrite log…) and
  the `user_id` filter are the ones the web already uses. The MCP layer adds no business rule.

## 2. Research (2026-11-08)

### 2.1 The protocol today

- The current revision is **2026-07-28** ([specification](https://modelcontextprotocol.io/specification/2026-07-28),
  [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)). It made MCP
  **stateless**: no `initialize` handshake and no `Mcp-Session-Id`; each request carries its
  protocol version and client capabilities in `_meta`; a server MUST answer `server/discover`;
  server-to-client requests (elicitation, sampling) are replaced by **Multi Round-Trip Requests**
  (a tool returns `resultType: "input_required"` and the client retries with the answers).
  Roots, Sampling and Logging are deprecated. Dynamic Client Registration is deprecated in favour
  of Client ID Metadata Documents.
- **Transport: Streamable HTTP** ([spec](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)).
  One endpoint that accepts POST; each JSON-RPC request is its own POST, answered with JSON or a
  short SSE stream. Servers **MUST validate `Origin`** (403 when present and invalid) against DNS
  rebinding, and SHOULD authenticate every connection. GET and DELETE (the 2025 session
  operations) get 405. Older clients (2025-03-26 … 2025-11-25) still send `initialize`; a server
  that wants them serves the old shape statelessly.
- **Tools** ([spec](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)): `name`,
  `title`, `description`, `inputSchema` (JSON Schema 2020-12), optional `outputSchema` (the result's
  `structuredContent` MUST then conform; the JSON SHOULD also be given as text), and `annotations`
  (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`; clients treat them as
  untrusted hints). Business errors are tool results with `isError: true` and a sentence the
  model can act on. Servers MUST validate inputs, apply access control, **rate limit tool calls**
  and sanitize outputs; clients SHOULD keep a human in the loop and ask before sensitive calls.
  `tools/list` MAY differ by the credential presented (for example by granted scopes) and SHOULD
  be in a stable order.
- **Authorization** ([spec](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization))
  is **optional**. When a server uses it, it acts as an OAuth 2.1 resource server: Protected
  Resource Metadata ([RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728)), 401 with
  `WWW-Authenticate: Bearer resource_metadata=…`, 403 `insufficient_scope` with the scope needed,
  audience-bound tokens ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html)), PKCE, client
  registration by Client ID Metadata Document or (deprecated) [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591),
  issuer check ([RFC 9207](https://datatracker.ietf.org/doc/html/rfc9207)). Tokens go in the
  `Authorization` header only, never in the URL. "Scope hierarchies" must be honoured (a broader
  scope implies the narrower one).
- **Security guidance:** [Security best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)
  (token passthrough forbidden, scope minimisation, confused deputy, session hijacking) and the
  spec's "Security and Trust & Safety" principles (consent, data privacy, tool safety).

### 2.2 The official TypeScript SDK

- **v2 is the stable line**: [`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server)
  **2.4.0** (published 2026-10-23, 16 days ago; implements 2026-07-28 and serves 2025 clients
  through a stateless fallback). Its only dependencies are `@modelcontextprotocol/core` 2.4.0 and
  `zod` ^4.2. The same exact version is **already in our lockfile** (the web's `shadcn` CLI
  depends on it), so adding it to the server adds almost nothing to the install.
  [Docs](https://ts.sdk.modelcontextprotocol.io/v2/), [serving guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/http),
  [repository](https://github.com/modelcontextprotocol/typescript-sdk).
- The v1 package `@modelcontextprotocol/sdk` (1.32.2) pulls Express, Hono, CORS and more; not used.
- **Mounting:** `createMcpHandler(factory, options)` returns a web-standard
  `fetch(Request, { authInfo, parsedBody }) → Response`. A per-request `McpServer` comes from the
  factory, so tools can depend on the caller. `authInfo` is pass-through: the SDK never reads
  tokens itself, so our own check stays in charge. Fastify adapters exist
  ([`@modelcontextprotocol/fastify`](https://www.npmjs.com/package/@modelcontextprotocol/fastify)
  2.0.1, a helper for new apps, and `@modelcontextprotocol/node`, which pulls Hono); neither is
  needed: Node 22 has `Request`/`Response`, so a 20-line bridge in the route does it.
- **Checked by a prototype** (scratchpad, 2026-11-08): Fastify 5 + `createMcpHandler` + the v2
  client over `fastify.inject`: `tools/list` shows annotations, `tools/call` returns
  `structuredContent`, and a raw 2025-style `initialize` is answered (SSE) by the fallback.

### 2.3 What clients support (2026-11)

| Client | Reaches the server from | Static bearer token | OAuth |
|---|---|---|---|
| **Claude Code** | the driver's computer | yes: `claude mcp add --transport http milewage https://…/api/v1/mcp --header "Authorization: Bearer mwa_…"` ([docs](https://code.claude.com/docs/en/mcp)); `.mcp.json` can read it from `${MILEWAGE_TOKEN}` | yes |
| **Claude Desktop, local** | the driver's computer, through the stdio bridge [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) (`npx mcp-remote <url> --header "Authorization:${MILEWAGE_AUTH}"`) | yes | yes |
| **claude.ai / Claude Desktop custom connector** | **Anthropic's cloud**, so the server must be reachable from the public internet ([docs](https://claude.com/docs/connectors/custom)) | only "Request headers", a beta for a limited set of organisations | yes ("Sign in"; Client ID Metadata Document or Dynamic Client Registration) |
| Private network for claude.ai | [MCP tunnels](https://claude.com/docs/connectors/mcp-tunnels/overview): Enterprise only, research preview, still wants OAuth on the server | — | — |
| Other clients (Cursor, VS Code, ChatGPT developer mode…) | varies; most take a URL plus headers or OAuth | mostly | mostly |

MileWage is reached over **Tailscale** (plan 19): the server is not on the public internet. So the
clients that work today without opening the server to the internet are the ones that run on a
computer in the tailnet: **Claude Code and Claude Desktop through `mcp-remote`**. Both take a static
bearer token.

### 2.4 How other self-hosted apps do it

- **Home Assistant** ([MCP Server integration](https://www.home-assistant.io/integrations/mcp_server/)):
  endpoint `/api/mcp`, OAuth 2.0 with PKCE against Home Assistant's own login, a **Read-only**
  option, tool sets, and only the entities the owner exposed to assistants.
- **Supabase** ([MCP guide](https://supabase.com/docs/guides/getting-started/mcp)): **read-only
  mode**, scoping to one project, explicit prompt-injection warning ("always review the output"),
  manual approval of each tool call; OAuth by default, a personal access token where a browser is
  not possible.
- **Grafana** ([mcp-grafana](https://github.com/grafana/mcp-grafana)): a service-account token
  with the least role that works; tools grouped and switchable.
- **Firefly III** (community servers, e.g. [horsfallnathan/firefly-iii-mcp-server](https://github.com/horsfallnathan/firefly-iii-mcp-server),
  [YakupEmreYerli/mcp-firefly-iii](https://glama.ai/mcp/servers/YakupEmreYerli/mcp-firefly-iii/tree)):
  wrap the existing REST API with a **personal access token**; a read-only token is suggested
  when writing is not needed.

Common pattern: the MCP layer is a thin client of the app's own API, there is a read-only switch
or scope, and the owner makes and revokes the credential in the app.

## 3. Design

### 3.1 Endpoint and transport

- **`POST /api/v1/mcp`**, Streamable HTTP, stateless, served by `createMcpHandler` from
  `@modelcontextprotocol/server@2.4.0` with the default 2025 fallback (`legacy: 'stateless'`), so
  `mcp-remote` and older clients work too. `GET`/`DELETE` answer 405 (spec).
- Under `/api/v1/` on purpose: Caddy already routes `/api/*` to the API (no Caddyfile change),
  and the existing hooks apply: `Cache-Control: no-store`, the restore 503, the disk-full 507,
  and the per-credential rate limit.
- **`Origin`:** a request that sends `Origin` must send the server's own origin, else 403
  (spec MUST; the endpoint never accepts cookies, so a browser page cannot use it anyway).
- **Read-only mode** (08 section 4.2): the hook that refuses every non-GET in read-only mode lets
  `/api/v1/mcp` through, because each tool's own call is a normal request that the same hook
  checks (reads work, writes get the usual 503 as a tool error).

### 3.2 Authentication: assistant access tokens (not OAuth, for now)

- **Choice:** a **static bearer token** the owner makes in the web, like the phone's device token.
  Reason: the clients that can reach a Tailscale-only server today (Claude Code, Claude Desktop
  via `mcp-remote`) take a header; claude.ai connectors need the server on the public internet,
  which plan 19 avoids. A token is what Supabase, Grafana and the Firefly III servers offer for
  the same case. OAuth 2.1 (section 8, OAuth) can come later without changing the tools.
- **Format:** `mwa_` + 43 base64url characters (256 random bits), so secret scanners can find a
  leaked one, like `mwd_` and `mwp_` (08 section 2.1).
- **At rest:** SHA-256 hash only (`mcp_tokens.token_hash`, unique). The token is shown **once**, in
  the response to the create call. Lookup is by hash, then the stored and computed hashes are
  compared again with `crypto.timingSafeEqual` (constant time). The `Authorization` header is
  already redacted from logs (`REDACT_PATHS`); the MCP code never logs a token or tool arguments.
- **Scopes:** `read` or `write`. `write` includes `read` (spec: scope hierarchies). A `read` token
  sees only read tools in `tools/list`; a write tool called anyway answers 403
  `insufficient_scope` (`WWW-Authenticate: Bearer error="insufficient_scope", scope="write"`).
- **Expiry:** optional, chosen at creation: 30 days, 90 days, a year, or never (default 90 days).
- **Revocation:** instant (opaque token, looked up on every request). `last_used_at` is updated at
  most once a minute, like devices.
- **Wrong or revoked token:** 401 with `WWW-Authenticate: Bearer realm="MileWage"`, problem body
  `auth_required` (no hint whether the token ever existed).
- **Limit:** at most 20 live tokens per owner.
- **Who can manage tokens:** web session only (`S`). No MCP tool can list, make or revoke tokens.

### 3.3 How a tool reaches the data (reuse, not a copy)

Each tool is `{ name, scopes, input schema, call }` where `call` maps the input onto **one or a few
REST requests** made **in process** with `fastify.inject()` (no network). For each call the MCP
layer mints a one-off **internal grant** (`mwi_` + 256 random bits, kept in memory for the length
of that one request, bound to its method and URL, deleted afterwards). The Authenticator accepts a
grant only for exactly that method and URL and turns it into the owner's principal. So:

- validation, defaults, cross-checks (vehicle belongs to you, shift is open, sign of an earnings
  entry…), events and the overwrite log are the REST route's own;
- a tool can only ever reach the routes named in its own code: the tool list **is** the allowlist;
- a grant can never be used from outside (never leaves the process, single use, method+URL bound).

A REST problem (`422 validation_failed` with `errors[]`, `404`, `409`, `503 read_only_mode`…)
becomes a tool result with `isError: true` and the problem's title, detail and field errors as
text, so the model can correct itself (spec: tool execution errors).

### 3.4 Units, money and time

- **Money:** integers in minor units, as in the REST API (`amount_cents`), with the currency named
  in every result (`currency: "CAD"`). Input descriptions say "in cents: $12.50 is 1250". The text
  part of a write result repeats the amount formatted in the driver's currency ("Added fuel
  expense #42: CA$54.20 on 2026-11-08") so the driver can check it in the approval prompt and
  the chat.
- **Distance:** REST gives metres (`_m`). Read tools add the driver's unit and the converted
  figure in the text; write tools take `distance` / `reading` **in the driver's unit** (`km` or
  `mi`, from Settings) and convert to metres (1 mi = 1609.344 m), because nobody reads an
  odometer in metres.
- **Time:** days are `YYYY-MM-DD` in the driver's time zone (as REST). Instants are given to the
  model as local ISO text (`2026-11-07T14:30`) plus the zone name, and write tools take local
  `YYYY-MM-DDTHH:mm`, converted in the driver's zone (`settings.timezone`). `get_profile` gives
  today's date and the zone so "yesterday" and "last week" resolve right.

### 3.5 Tools

Order is stable (spec SHOULD). All take and give JSON objects; `outputSchema` is declared for the
small fixed shapes (profile, summary, write results) and left open for lists that mirror REST.
A tool whose module is off (for example `get_tax_estimate` without `tax`) is not listed.

**Read (`read` scope; `readOnlyHint: true`, `openWorldHint: false`)**

| Tool | Input | REST used | Notes |
|---|---|---|---|
| `get_profile` | none | `GET /settings`, `/vehicles`, `/platforms`, `/expenses/categories` | country, region, currency, distance unit, time zone, today, week start, vehicles, platforms, expense categories, which modules are on. Call first. |
| `get_summary` | `from?`, `to?`, `platform?` | `GET /summary` | shifts, hours, earnings, tips, km/mi split, deduction, hourly; default this month |
| `get_analytics` | `from`, `to`, `group?`, `bucket?` | `GET /analytics` | period groups (module `analytics`) |
| `list_shifts` | `from?`, `to?`, `status?`, `vehicle_id?`, `limit?` (≤ 50), `cursor?` | `GET /shifts` | newest first, with `next_cursor` |
| `get_shift` | `shift` (id) | `GET /shifts/{ref}`, `/trips`, `/earnings` | one shift with trips and earnings by platform |
| `list_expenses` | `from?`, `to?`, `category?`, `deductible?`, `vehicle_id?`, `limit?`, `cursor?` | `GET /expenses` | |
| `get_expense_totals` | `year?` | `GET /expenses/totals` | by category for a calendar year, deductible part |
| `list_goals` | none | `GET /goals` | progress at read time |
| `get_tax_estimate` | `year` | `GET /tax/{year}` | an estimate, never a filing (module `tax`) |
| `list_odometer_readings` | `vehicle_id?`, `kind?`, `from?`, `to?` | `GET /odometer` | |

**Write (`write` scope; `readOnlyHint: false`, `openWorldHint: false`)**

| Tool | Input | REST used | `destructiveHint` / `idempotentHint` |
|---|---|---|---|
| `add_expense` | `spent_on`, `category`, `amount_cents`, `merchant?`, `deductible?`, `business_pct?`, `vehicle_id?`, `shift?`, `notes?` | `POST /expenses` | false / false |
| `update_expense` | `id` + any of the fields above | `PATCH /expenses/{id}` | true / true |
| `add_earning_entry` | `shift`, `platform`, `type` (fare, tip, bonus, …), `amount_cents` (minus for fees), `note?` | `POST /shifts/{ref}/earnings/{platform}/entries` | false / false |
| `record_odometer` | `kind` (`shift_start`, `shift_end`, `year_start`, `year_end`), `reading` (driver's unit), `at` (local time), `shift` or `vehicle_id` | `PUT /shifts/{ref}/odometer/{kind}` or `POST /odometer` | true / true |
| `update_shift` | `shift`, `notes?`, `vehicle_id?` | `PATCH /shifts/{ref}` | true / true |
| `add_trip` | `shift`, `kind` (active, deadhead, personal), `started_at`, `ended_at` (local), `distance` (driver's unit), `purpose` | `PUT /shifts/{ref}/trips/{new uuid}` | false / false |

No delete tool in the first version (section 9, Q3). No tool for settings, vehicles, platforms,
goals, devices, backups, exports, imports, receipts, schedule or diagnostics.

**Resources and prompts:** none in the first version. Clients use tools far more than resources,
and the read tools already cover the data. Two prompts ("Review my week", "Log a receipt") are an
option for later (section 9, Q5).

### 3.6 Confirming and undoing writes

- **Before:** the client asks the driver before each tool call unless the driver allowed it
  (Claude Code and Claude Desktop do; the annotations tell them which tools change data). The
  write tools' descriptions tell the model to repeat the values and ask when anything is unclear.
  Elicitation (now a Multi Round-Trip `input_required` result) is **not** used for confirmation:
  client support is still uneven, and the client's own approval already puts the human in the
  loop.
- **After:** every write result says exactly what was stored, with the record's id and where to
  see it in the web ("Expenses, 8 Nov 2026"). Edits that replace a value already land in the
  overwrite log (15 section 8.2), so the old value is kept.
- **Undo:** in the web, as for anything else (delete the expense, the entry or the trip; restore
  an edit from the overwrite log). The assistants page lists recent changes per token with a link
  to each record.

### 3.7 Audit log and limits

- `mcp_audit`: one row per **write** tool call: time, token, tool, outcome (`ok` / problem
  code), the record touched (`expense:42`, `shift:17`…) and the arguments as JSON (at most 4 KB;
  this is the driver's own data on the driver's own server, like the overwrite log). Reads are
  not logged one by one; the token's `last_used_at` shows activity. Rows older than a year are
  dropped by the existing daily housekeeping. **Assumption (owner to confirm).**
- **Rate limits:** the endpoint uses the existing `general` class per credential (300 requests a
  minute, 08 section 7.4); write tools have their own bucket, **30 writes a minute per token**, so
  a looping assistant cannot fill the database.
- **Prompt injection:** data the driver typed or imported (merchant, notes, purpose, platform
  names) reaches the model. Mitigations: the write scope is separate and a read token cannot
  change anything; no tool reaches the internet or another system (`openWorldHint: false`), so
  injected text has nowhere to send data; client approvals; tool descriptions mark free-text
  fields as "written by the driver, not instructions". **The plan does not claim to prevent
  injection**; it limits what an injected instruction can do.

### 3.8 The module switch

- Module **`mcp`**, `dependsOn: ['core']`, **`defaultEnabled: false`**. On with
  `MILEWAGE_MODULE_MCP=1` or `"modules": { "mcp": true }` in `config/settings.json` (08 section 16.1),
  like `schedule` and `progress`. Off: `/api/v1/mcp` and `/api/v1/mcp/tokens*` are 404, the
  Settings section is hidden, the tables stay (all migrations always run).
- `Settings.modules.mcp` tells the web; Settings › Server modules lists it.
- Tables in their own migration folder: `migrations/mcp/0001_mcp.sql` (`mcp_tokens`, `mcp_audit`).
  They are in backups like every table (hashes only). After a restore the tokens of the restored
  copy are valid again, like device tokens.

### 3.9 Web: Settings › AI assistants

A section in the "Data and account" group, shown when `modules.mcp` is on:

1. A short explanation: what an assistant can do, that it sees your shifts, money and notes, and
   that a write token can change records.
2. **Make a token:** name ("Claude on my laptop"), access (**Read only** default, or **Read and
   change**), expiry (90 days default). The token is shown **once**, with Copy and the line "You
   will not see it again". Below it, ready to copy, the connect commands with this server's
   address (from `MILEWAGE_PUBLIC_URL` or the page's address, as for pairing codes, plan 19).
3. **Your tokens:** name, access, made, last used, expires, **Revoke** (with confirmation).
4. **Recent changes by assistants:** the last 50 audit rows (time, token, what changed, link).

### 3.10 Connecting a client (in `infra/docs/install.md` section 7)

Claude Code (on a computer in your tailnet):

```
claude mcp add --transport http milewage https://<your-box>.ts.net/api/v1/mcp \
  --header "Authorization: Bearer mwa_…"
```

Claude Desktop (Settings › Developer › Edit config, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "milewage": {
      "command": "npx",
      "args": ["-y", "mcp-remote@0.15.2", "https://<your-box>.ts.net/api/v1/mcp",
               "--header", "Authorization:${MILEWAGE_AUTH}"],
      "env": { "MILEWAGE_AUTH": "Bearer mwa_…" }
    }
  }
}
```

(`mcp-remote`'s README writes the header as `Authorization:${VAR}` with the space inside the
variable, because some launchers split arguments on spaces. Version 0.15.2 is the newest one at
least two weeks old on 2026-11-08. Its `--header-file` option keeps the token out of the process
list.) Test any client with the
[MCP Inspector](https://github.com/modelcontextprotocol/inspector).

claude.ai custom connectors need the server on the public internet and OAuth (or the
request-header beta): not supported until section 8's OAuth step and a public address are chosen.

### 3.11 Caddy and Tailscale

- No Caddyfile change: `/api/*` already goes to the API, with a 2 MB body limit.
- Answers are short (one JSON body, or a short SSE stream that ends with the result), so
  buffering by `encode` or a proxy does not matter; `X-Accel-Buffering: no` is sent on SSE anyway.
- Do **not** use `tailscale funnel` to make the endpoint public for claude.ai: a static token on
  the public internet is a much bigger exposure than inside the tailnet. If the owner wants
  claude.ai, do the OAuth step first (section 9, Q1).

## 4. Modularity (README section 1.3)

| Module | Interface | Depends on | Toggle | Removal |
|---|---|---|---|---|
| `mcp` | `POST /api/v1/mcp`; `GET/POST /mcp/tokens`, `DELETE /mcp/tokens/{id}`, `GET /mcp/audit`; Authenticator `useTokenBranch` | `core` (tools for `expenses`, `earnings`, `goals`, `tax`, `analytics` appear only when those are on) | `modules.mcp`, default **off** | switch off: routes 404, screen hidden; nothing else references it |

The tool registry (`apps/server/src/mcp/tools/*.ts`) is the attach point: a module that wants a
tool adds a file there. No other module imports MCP code.

## 5. Pull requests (each ≤ about 400 changed lines without the lockfile and generated types)

| PR | Branch | What |
|---|---|---|
| **M0** | `pr-M0-mcp-plan` | This plan. |
| **M1** | `pr-M1-mcp-tokens` | Server: module `mcp` (off), migration `mcp/0001`, `GET/POST /mcp/tokens`, `DELETE /mcp/tokens/{id}`, `modules.mcp` in Settings, OpenAPI, tests. |
| **M2** | `pr-M2-mcp-endpoint` | Server: `POST /api/v1/mcp` with the SDK, token check, `Origin` check, 401/403 answers, the internal grant, read-only-mode pass-through; read tools `get_profile`, `get_summary`. Tests with the official v2 client over `inject`. |
| **M3** | `pr-M3-mcp-read-tools` | Server: `list_shifts`, `get_shift`, `get_analytics`, `list_expenses`, `get_expense_totals`, `list_goals`, `get_tax_estimate`, `list_odometer_readings`; module-gated listing. |
| **M4** | `pr-M4-mcp-write-tools` | Server: write scope, `add_expense`, `update_expense`, `add_earning_entry`, `mcp_audit` rows, the 30-a-minute write bucket. |
| **M5** | `pr-M5-mcp-write-more` | Server: `record_odometer`, `update_shift`, `add_trip` (local time and unit conversion), `GET /mcp/audit`. |
| **M6** | `pr-M6-mcp-web` | Web: Settings › AI assistants (make, show once, copy, connect commands, revoke, recent changes). |
| **M7** | `pr-M7-mcp-docs` | `infra/install.md` "Connect an AI assistant", 08 section 2.1 principal table, smoke check through Caddy. |
| later | — | OAuth 2.1 (Q1), prompts (Q5), delete tools (Q3). |

## 6. Tests (each PR's tests fail without it)

- Tokens: shown once; only the hash stored; revoke works at once; expired and revoked refused;
  the 21st live token refused; device and session credentials cannot call `/api/v1/mcp`; a token
  cannot call any REST route directly.
- Endpoint: module off is 404; no token, wrong token, revoked token 401 with `WWW-Authenticate`;
  a foreign `Origin` 403; GET 405; both a 2026-07-28 client and a 2025 `initialize` work.
- Tools: each read tool against seeded data matches the REST answer; a read token does not list
  write tools and gets 403 `insufficient_scope` when it calls one; a REST 422 comes back as
  `isError: true` with the field message; writes make the same rows as the web would, write an
  audit row, and the 31st write in a minute is refused.

## 7. Risks

- **The SDK is young** (v2.0.0 in July 2026, now 2.4.0). Pinned to an exact version; the bridge is
  small and the tests use the official client, so an upgrade shows breakage at once.
- **Prompt injection** (section 3.7): limited, not prevented.
- **A leaked write token** can add or change records until revoked (not delete; no secrets).
  Mitigation: read-only default, expiry default 90 days, last-used shown, one-click revoke, audit.
- **Client support moves fast** (connector header beta, MCP tunnels, CIMD). The token design
  does not block OAuth later.
- **Model mistakes in units** (cents, km/mi). Mitigated by unit-aware inputs, the formatted
  confirmation text, and undo in the web.

## 8. Later: OAuth 2.1

To let claude.ai connectors (and other cloud clients) in, MileWage would become its own small
authorization server: Protected Resource Metadata at
`/.well-known/oauth-protected-resource/api/v1/mcp`, AS metadata, `/authorize` (the owner signs
in to the web and approves "Claude wants read and write access"), `/token` with PKCE and refresh,
Client ID Metadata Documents (Claude's "published identity"), and audience-bound tokens. Same
scopes, same tools; tokens made this way appear in the same list and are revoked the same way.
It only helps if the server is reachable from the internet, which plan 19 avoids. About three or
four PRs.

## 9. Owner to decide

1. **Q1 Auth:** static tokens now, OAuth later only if you want claude.ai/phone Claude to reach a
   public server? (Recommended: yes, tokens now.)
2. **Q2 Switch:** module off by default, turned on in `config/settings.json` / `MILEWAGE_MODULE_MCP=1`
   like `schedule`. Or do you want a switch in the web (a runtime setting instead of a module flag)?
3. **Q3 Deleting:** no delete tools at first (undo in the web). Add `delete_expense` /
   `delete_earning_entry` limited to records the assistant made in the last 24 hours?
4. **Q4 Token defaults:** read-only by default, 90-day expiry by default, 20 tokens at most?
5. **Q5 Prompts:** add "Review my week" and "Log a receipt" prompts?
6. **Q6 Audit retention:** keep assistant change rows for one year?
7. **Q7 Receipts:** let an assistant attach a receipt photo to an expense (needs file upload over
   MCP)? Not in this plan.
