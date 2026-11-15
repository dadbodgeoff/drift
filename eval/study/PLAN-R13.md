# Plan, round 13: the practice map (2026-11-09)

This follows [`PLAN-R11.md`](PLAN-R11.md) (D13) and the round-12 records in `research/2026-11-09/`. There is no PLAN-R12. Main is `f0b7889f`.

**Data.** Every figure here is a build-set aggregate:
- the apps11 blind check: [`research/2026-11-09/apps11-blind-check.md`](research/2026-11-09/apps11-blind-check.md), aggregates only;
- map11 and the round-11 plans.

No blind pool, held-out manifest or pilot repository was opened.

## Why

Drift as shipped is a rule miner: facts, then roles × families, then Wilson and lift, then drafts, then the show policy, then caps. On apps-blind at F12:
- **83.3%** of repos are silent at the root;
- **0.4%** of files are under a shown convention;
- **95.0%** of production files are in a role;
- **98.7%** of imports resolve;
- **65** conventions were mined and **3** shown.

The map is not where coverage dies; the gate is. The product owner asks for something else: a **descriptive** inventory. For each cross-cutting concern it gives:
- what the codebase does, with each variant and its share;
- where each variant lives, and why it differs;
- a way to promote a variant to a rule.

This is always on. It never goes through the show policy or the caps. Enforcement keeps today's gates.

## Scope

**Today: the engine, 9 concerns, and the structure fixes.**
- The 9 concerns: `api`, `authn`, `authz` (with tenant scoping), `errors`, `logging`, `validation`, `config` (with secrets and feature flags), `data_access` and `testing`.
- Structure fixes:
  - production vs test dependency edges;
  - re-exported handlers;
  - compose files at any depth;
  - a guard that is not one: every FastAPI `Depends` counts as a guard today.

**Next round, design only (§8):** outbound calls, background jobs and queues, frontend data fetching, state and design system, hygiene, declared vs actual, and change over time.

---

## 0. Contract (freeze first; workstream A)

### 0.1 Concern ids

| id | Title | Slice |
|---|---|---|
| `authn` | Authentication | 1 |
| `authz` | Authorization and tenant scoping | 1 |
| `errors` | Error handling | 2 |
| `logging` | Logging and observability | 3 |
| `api` | API design and responses | 4 |
| `validation` | Input validation | 5 |
| `config` | Config, secrets, feature flags | 6 |
| `data_access` | Data access | 7 |
| `testing` | Testing practice | 8 |

The id strings are frozen. Every JSON output, the MCP tool, the Studio, the `.drift/config.yaml` keys and the eval scripts use them.

### 0.2 `crates/drift-core/src/facts.rs` additions

- **Version.** `FACTS_SCHEMA_VERSION` goes from **10 to 11**, with this note added to the doc comment: `11: practice facts (body_checks, responses, log_calls, catches, headers, inputs, handles_errors, test_requests, mocks, route_matchers, dev_only)`.
- **Serialisation.** Every new field is `#[serde(default, skip_serializing_if = ...)]`, so schema-10 facts still deserialize. The bump makes every cache key miss once, by design.
- **Lowering versions.** TS `LOWERING_VERSION` goes from 37 to **38** (`crates/drift-ts/src/lower.rs:18`). Python goes from 17 to **18** (`crates/drift-py/src/lower.rs:23`; main is already at 17). The lead renumbers at merge.
- **Studio.** `SUPPORTED_FACTS` becomes `[4..11]`.

New types. All derive `Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize`. Enums are `#[serde(rename_all = "snake_case")]` and derive `Copy`.

```rust
/// A check in the body that turns a caller away (the condition of a REJECTS_CALLER-
/// style exit, or of a NotFound exit), and what the condition reads. Recorded only
/// where `controls::REJECTS_CALLER` is recorded (outside catch/callbacks, before the
/// continuation), plus 404 exits under a condition that reads a subject.
pub struct BodyCheck {
    /// Canonical callee whose result the condition tests, directly or through a local
    /// binding (`const s = await auth(); if (!s) ...` -> `pkg:next-auth#auth`;
    /// a FastAPI parameter bound to `Depends(get_current_user)` ->
    /// `app/deps.py#get_current_user`). `param:<name>` for a handler parameter,
    /// `header:<name>` for a request header, "" when none can be read.
    pub source: String,
    /// Member path read off the source, cut at MAX_MEMBER_DEPTH (`.user.orgId`,
    /// `.role`); "" for the value itself.
    pub reads: String,
    /// What it is compared with: "" (truthiness), `param:<name>`, `header:<name>`,
    /// `literal` (a string or number literal, never echoed), `call:<canonical>`.
    pub compares: String,
    pub outcome: CheckOutcome,
}
pub enum CheckOutcome { #[default] Unauthenticated, Forbidden, NotFound, Throttled, SignInRedirect }

/// One response the symbol sends.
pub struct ResponseFact {
    /// HTTP status; 0 when it is not a literal or a known constant.
    pub status: u16,
    pub via: ResponseVia,
    /// Canonical builder or class (`pkg:next/server#NextResponse.json`,
    /// `pkg:fastapi#HTTPException`, `lib/errors.ts#ApiError(new)`); "" for a literal.
    pub builder: String,
    /// Declared response model or schema, canonical (`response_model=UserOut`,
    /// `@ApiOkResponse({ type: UserDto })`, tRPC `.output(schema)`); "" none.
    pub model: String,
    /// Top-level keys of the body object literal, sorted, at most 8 (`error`, `code`,
    /// `message`): the error envelope.
    pub keys: Vec<String>,
    /// Inside a catch / except.
    pub in_catch: bool,
}
pub enum ResponseVia { #[default] Return, Throw, Setter, Abort, Declared, Redirect }

/// A call to a level-named method or a print (a log-call candidate; the classifier
/// decides whether the receiver is a logger).
pub struct LogCall {
    /// Canonical callee as in `calls` (`global#console.error`, `lib/log.ts#logger.info`,
    /// `app/x.py#logger.exception`, `pkg:loguru#logger.info`, `global#print`).
    pub callee: String,
    /// Normalised level (drift_core::practice::LOG_LEVELS): trace, debug, info, warn,
    /// error, fatal, exception, log, print.
    pub level: String,
    pub in_catch: bool,
    /// An object literal argument, or keyword arguments beyond the message (`extra=`,
    /// structlog kwargs): structured logging.
    pub structured: bool,
    /// An argument is the caught error binding (or `exc_info=True`).
    pub passes_error: bool,
}

/// One catch / except clause.
pub struct CatchFact {
    /// Canonical classes caught, sorted; `*` for a bare catch.
    pub catches: Vec<String>,
    /// What the clause does, sorted: `rethrow`, `throw:<canonical>`, `log`,
    /// `respond:<status>`, `report:<canonical>` (Sentry and the like), `return`,
    /// `swallow` (none of the others).
    pub does: Vec<String>,
}

/// A request a test makes (FileFacts of test files only).
pub struct TestRequest {
    /// GET, POST, ... or ANY.
    pub method: String,
    /// Route template, dynamic segments as `[*]` (drift_core::practice::normalize_route);
    /// "" when not a literal.
    pub route: String,
    /// Canonical module whose handler the test imports and calls directly (a Next.js
    /// `route.ts` GET called in the test), "" none.
    pub target: String,
    /// Status codes asserted in the same test block, sorted.
    pub statuses: Vec<u16>,
}

/// Route patterns a middleware applies to (Next.js `config.matcher`, Clerk
/// `createRouteMatcher([...])`).
pub struct RouteMatcher {
    /// `config.matcher`, or the binding the matcher is assigned to.
    pub binding: String,
    /// Route-shaped patterns (drift_core::practice::valid_route), sorted, at most 64.
    pub patterns: Vec<String>,
}
```

`Symbol` gains these fields (`Vec`s, omitted when empty, sorted and de-duplicated in `normalize()`):

| Field | Type | Cap | Meaning |
|---|---|---|---|
| `body_checks` | `Vec<BodyCheck>` | 16 | see type |
| `responses` | `Vec<ResponseFact>` | 16 | see type |
| `log_calls` | `Vec<LogCall>` | 32 | see type |
| `catches` | `Vec<CatchFact>` | 16 | see type |
| `headers` | `Vec<String>` | 16 | request header names read, lower-case, only from literals (`req.headers.get("x-org-id")`, `headers().get(..)`, Nest `@Headers("x")`, FastAPI `Header(alias=..)`, or a `x_org_id: str = Header()` parameter mapped `_` to `-`) |
| `inputs` | `Vec<String>` | 8 | canonical types or schemas that request input is validated into (Nest `@Body() dto: CreateDto`, a FastAPI body or query model, tRPC `.input(x)`, `schema.parse(await req.json())`, next-safe-action `.schema(x)`) |
| `handles_errors` | `Vec<String>` | 8 | canonical error classes this symbol is registered to handle (`@app.exception_handler(X)`, `add_exception_handler(X, h)`, Nest `@Catch(X)`, Flask `@errorhandler(404)` as `status:404`), `*` for any (Express 4-arity error middleware, a tRPC `errorFormatter`) |

`FileFacts` gains:
- `test_requests: Vec<TestRequest>` (cap 256);
- `mocks: Vec<String>` (cap 64): canonical modules mocked, as in `vi.mock` / `jest.mock` / `@patch("a.b")` / `mocker.patch`, plus `msw:<route>` for MSW handlers;
- `route_matchers: Vec<RouteMatcher>` (cap 8).

`PackageFacts` gains `dev_only: Vec<String>` (package names). It lists the dependencies that appear only in npm `devDependencies`, or only in Python dev, test or lint groups (`[dependency-groups]`, `[tool.poetry.group.dev]`, optional-dependencies named `dev`/`test`/`tests`/`lint`). `dependencies` keeps its meaning, so `DependencyVersion` rules are unchanged.

**String policy.** The facts.rs header gains an amendment to "string literals are recorded only as a count". Exactly three shape-checked kinds may be echoed:
- header names (`^[a-z0-9-]{1,64}$`);
- route patterns (`valid_route`: starts with `/`, `[A-Za-z0-9_\-./\[\]{}:*()+?]`, at most 120 chars);
- numeric status codes.

Anything else is dropped. Every renderer still passes them through `report::sanitize`.

**New module `drift_core::practice`.** This lives in `crates/drift-core/src/practice.rs` and is shared by C and D, so neither edits the other's crate:
- `LOG_LEVELS: &[(&str, &str)]`: method name to level (`warning` maps to `warn`, `critical` to `fatal`, `exception` to `exception`, `log` to `log`);
- `normalize_level`;
- `valid_header`, `valid_route` and `normalize_route`, which maps `[id]`, `:id`, `{id}` and `<int:id>` to `[*]`;
- `TRPC_CODE_STATUS` (tRPC code to status) and `NEST_EXCEPTION_STATUS` (`NotFoundException` to 404, and so on), used by TS only but kept here so the table is shared and tested once;
- `caps::{BODY_CHECKS, RESPONSES, LOG_CALLS, CATCHES, HEADERS, INPUTS, HANDLES, TEST_REQUESTS, MOCKS, MATCHERS, MATCHER_PATTERNS}`.

**Determinism.**
- Lowering collects each field into a `BTreeSet`, then sorts and truncates to the cap. Truncation happens after sorting, so it does not depend on traversal order.
- `normalize()` sorts and de-duplicates every new `Vec`, including the inner `keys`, `catches`, `does` and `statuses`.
- New tests in `crates/drift-core`: a schema-10 fixture round-trips (old facts deserialize), normalisation is idempotent, every cap holds, and `valid_*` reject non-route and non-header strings.

### 0.3 `drift practices --json` (version 1)

```json
{
  "version": 1,
  "commit": "<engine commit, as census>",
  "facts_schema": 11,
  "scope": { "concern": null, "package": null, "path": null },
  "summary": { "population": 0, "known": 0, "none": 0, "unknown": 0, "coverage": 0.0,
               "concerns_at_target": 0, "target": 0.9 },
  "concerns": [{
    "id": "authn",
    "title": "Authentication",
    "unit": "entry_point",
    "population": { "total": 0, "known": 0, "none": 0, "unknown": 0, "coverage": 0.0,
                    "left_out": { "tests": 0, "non_production": 0 } },
    "variants": [{
      "id": "P-1a2b3c",
      "key": "wrap:apps/web/lib/auth.ts#withWorkspace",
      "label": "wrapped in withWorkspace()",
      "kind": "known",
      "mechanisms": ["wrap"],
      "instruments": ["apps/web/lib/auth.ts#withWorkspace"],
      "source": "usage",
      "members": 0, "share": 0.0,
      "where": {
        "packages":   [{ "package": "apps/web", "members": 0, "share_of_package": 0.0 }],
        "dirs":       [{ "dir": "apps/web/app/api", "members": 0 }],
        "roles":      [{ "role": "R-xxxxxx", "members": 0 }],
        "entry_kinds":[{ "kind": "http", "members": 0 }],
        "methods":    [{ "method": "GET", "members": 0 }]
      },
      "sets_apart": [{ "attribute": "dir:apps/web/app/api/webhooks",
                       "in_variant": [9, 9], "in_dominant": [0, 170],
                       "separation": 0.0, "purity": 1.0 }],
      "examples":   [{ "path": "", "symbol": "", "line": 0 }],
      "exceptions": [{ "path": "", "symbol": "", "line": 0, "variant": "P-..." }],
      "conventions":[{ "id": "D-...", "status": "accepted", "mode": "block" }],
      "promotable": { "rule": "wrapped_by", "role": "R-xxxxxx" }
    }],
    "unknown": { "members": 0,
                 "reasons": [{ "reason": "opaque_wrapper", "members": 0 }],
                 "instruments": [{ "instrument": "", "members": 0 }],
                 "examples": [] },
    "by_package": [{ "package": "", "total": 0, "coverage": 0.0,
                     "variants": [{ "id": "P-...", "members": 0, "share": 0.0 }] }],
    "divergence": [{ "package": "", "dominant": "P-...", "repo_dominant": "P-...",
                     "members": 0 }]
  }],
  "not_covered": ["..."]
}
```

**Field rules:**
- `kind` is one of `known` or `none`. A `none` variant is a recorded absence: "no guard, nothing opens it", "no logging", "not tested".
- `source` is `vocab`, `usage` or `declared`; `declared` means it came from `.drift/config.yaml`, under `practices:`.
- `promotable` is null when no existing `Rule` expresses the variant.
- Unknown reasons are `unparsed`, `opaque_wrapper`, `unresolved`, `no_symbol`, `dynamic` and `unclassified`.

**Determinism and ordering:**
- Variant ids are `P-` plus 6 hex digits of blake3 of `concern + "\0" + key`.
- Shares are exact integer ratios, rounded with `mine::r3` at output.
- Variants sort by members (descending), then by key. The `where` lists are capped at 8, `examples` at 3, `exceptions` at 10 (the rest counted as `exceptions_more`), and `sets_apart` at 3.

**Text form.** `drift practices` without `--json` renders the same data, one block per concern:
`error handling (entry points 212, 96% known): A thrown HTTPException, mapped by the app handler 80% [services/api] | B try/catch returning NextResponse.json({error}) 15% [apps/web/app/api; sets apart: dir apps/web/app/api 31/32 vs 0/170] | C none 5%`

**Fixtures for B (built in A).**
- `crates/drift-mine/tests/fixtures/practices/{next_clerk,fastapi_split,nest_mixed}.facts.json` are hand-written schema-11 `RepoFacts`. Together they exercise every new field: Next.js with in-body auth, middleware matchers and re-exports; FastAPI with `Depends(get_db)` and `Depends(get_current_user)` plus in-body org checks; Nest with guards and filters.
- An insta golden for the empty engine output (`{"version":1,...,"concerns":[]}`).
- B develops entirely against these fixtures.

---

## 1. Concern taxonomy and classification

The same engine serves every concern. Each concern module does three things:
1. It picks a **population** of code units.
2. It derives each unit's **instruments** (the things it uses for the concern) and **mechanisms** (how each instrument is applied).
3. It keys the unit by the sorted set of `mechanism:instrument`.

That set is the variant key. **Split auth is one policy**: a unit guarded by middleware plus an in-body org check has the key `middleware:clerkMiddleware+body:auth().orgId`, and when the combination recurs it is one variant.

**How instruments are classified,** in order:
1. **Declared:** `.drift/config.yaml` `practices: {<concern>: {<canonical>: <label>}}`, written by a person.
2. **Vocabulary:** the library tables below.
3. **Usage:** an in-repo definition classified by what it does (below).
4. Otherwise the instrument is `unclassified:<short name>`, which counts as unknown.

Vocabularies live in `crates/drift-mine/src/practices/libraries.rs`, as `*_LIBRARIES` / `*_CALLEES` consts (the vocab test forbids `const *_WORDS` outside `vocab.rs`). Every auth decision calls `security::authenticates` / `security::callee_is_guard`, which are existing grant sites, and never `grant::` directly.

**Unknown is shown, never hidden.**
- Coverage counts unknown against the concern.
- The top unclassified instruments are listed with their counts, so that one line of `practices:` config makes them known.
- No unknown unit is ever put in `none`.

### 1.1 authn (population: production entry points)

- **Population.** `http`, `server_action`, `graphql`, `rpc` and `job` entry points, through the re-export resolver (§2.5). Tests and `NonProduction` are left out. `page`/`layout` form a sub-population reported apart.
- **Facts.**
  - `wraps` of kind Call, Decorator, Extends, Config and AppHook, each kept only where `security::authenticates` holds;
  - in-body guard calls: `calls` that pass `callee_is_guard` and sit early in `order`;
  - `body_checks` with outcome Unauthenticated or SignInRedirect;
  - middleware coverage: `route_matchers` plus the Next.js middleware entry point;
  - `opens` (AllowAny);
  - Python router dependencies, already folded into `wraps` by `crates/drift-py/src/link.rs` `build_adapter_tables`.
- **Mechanisms:** `wrap`, `decorator`, `dependency`, `base`, `middleware`, `config`, `app_hook`, `body_call`, `body_check`, `opens`.
- **Vocabulary:** `security::library_guard`, extended:
  - Clerk: `auth().protect`, `clerkMiddleware`, `auth()` plus a check, `currentUser`;
  - NextAuth / Auth.js: `getServerSession`, `auth`, `withAuth`;
  - Supabase: `auth.getUser`;
  - Lucia: `validateRequest`; better-auth: `auth.api.getSession`; iron-session: `getIronSession` (identifies the caller only);
  - Passport, `@nestjs/passport` `AuthGuard` and Nest `@UseGuards`;
  - express-jwt, express-openid-connect;
  - FastAPI security schemes and fastapi-users `current_user`;
  - Django `login_required` / mixins, DRF permissions;
  - flask-login, flask-jwt-extended.
- **Usage:** an in-repo wrapper or callee is authn when `authenticates` or `callee_is_guard` holds.
- **None:** no guard, and nothing unparsed or opaque on the route. Public markers (`opens`) form their own known variant, "explicitly public".
- **Fixes the pilot's gaps:**
  - non-guard `Depends` (such as `get_db`) are no longer instruments here;
  - in-body checks come from `body_checks`;
  - split auth gets one key;
  - re-exports are resolved.

### 1.2 authz and tenant scoping (population: authn units that are not `none`)

There are two dimensions, and the key is `role:<...>|scope:<...>`.
- **Role or permission check:**
  - privileged wrappers (`adminProcedure`, `RolesGuard`, `permission_required`, DRF object permissions);
  - in-body checks (`body_checks` Forbidden whose `reads` names role/permission/admin, or which compare against a literal);
  - policy-library calls (CASL `ability.can`, casbin, oso, cerbos).
- **Tenant scope source:**
  - header: `headers` names matching `org|organization|workspace|tenant|team|account` (`x-session-org-id`);
  - session claim: a `body_checks` `reads` of `.orgId` and similar;
  - path param: route segments `[orgId]`, `{org_id}`, `<org_id>`;
  - query filter only: data-access `args` keys `where.organizationId`, `filter(org_id=)`.

  The enforcement form is `check` (a body_check comparing the scope with the subject, outcome Forbidden or NotFound), `filter` (a scoped query only) or `none`.

### 1.3 errors

There are two populations.
- **(a) Entry points:** how errors become responses.
  - `mapped_by_wrapper`: a wrapper whose definition has `catches` with `respond:*`;
  - `app_handler`: thrown classes covered by a `handles_errors` symbol in the package, Nest `@Catch` filters, FastAPI `exception_handler`, a DRF `EXCEPTION_HANDLER` setting;
  - `in_body_try`: `catches` → `respond:<status>`;
  - `throw_framework`: `responses` via Throw of HTTPException, TRPCError or HttpException;
  - `bubble`: none of these, so the framework default 500.
- **(b) Services** (exported production functions and classes outside entry roles that throw or catch):
  - what they throw: a repo error family (lineage_exception / extends Error, grouped by base);
  - a generic `Error` or `Exception`;
  - framework errors thrown from services;
  - for catches: re-wrap, log-and-rethrow, swallow.
- **Vocabulary:** HTTPException (fastapi, starlette, werkzeug), DRF exceptions, Django Http404, Nest `*Exception`, TRPCError, `next/navigation#notFound`, Boom, http-errors, Sentry `captureException`.

### 1.4 logging and observability

There are three populations.
- **(a) Symbols with at least one candidate log call.** The instrument is the logger's origin:
  - `console`, `print`;
  - a library logger (pino, winston, bunyan, consola, loglevel, tslog, `@nestjs/common#Logger`, `logging.getLogger`, structlog, loguru);
  - the repo's own logger module, which usage identifies.

  Acquisition is read through the receiver binding: `file#logger.info` maps to the `file#logger` symbol, whose `calls` hold the factory (`pkg:pino#default`, `pkg:logging#getLogger`). An in-repo module whose exported binding is built that way, and is called from at least 3 files, is "repo logger X (pino)". A level-named call on a receiver with no logging origin is `unclassified` (no guess).

  The style dimension is `structured` vs `message`.
- **(b) Catch clauses:** `log`, `report` or neither.
- **(c) Entry points:** whether they log or trace at all (OpenTelemetry `trace.getTracer`/`startActiveSpan`, Sentry, `@sentry/nextjs` wrappers, Datadog `dd-trace`, `logfire`).

### 1.5 api (population: http entry points)

- **Route style:** Next.js file route, express/fastify/hono router, Nest controller, FastAPI/Flask/Django/DRF view, tRPC procedure.
- **Response builder:** the dominant `responses.builder`.
- **Declared model:** `model` non-empty, or none.
- **Error envelope:** the `keys` of non-2xx responses, e.g. `{error}`, `{message}` or `{error,code}`.
- **Status codes:** which are used per method, e.g. POST → 201 vs 200.
- **Route shape:** versioned prefix (`/v1`), plural resource segments.

The key combines builder, model and envelope. Status and shape are reported as attributes, not split into separate variants, so the profile does not fragment.

### 1.6 validation (population: entry points with `reads_input`, or whose input is unknown)

- **Mechanism:**
  - schema at the boundary: `inputs` non-empty, `validates`, tRPC/next-safe-action `INPUT_STEPS` in `derives_from`;
  - typed model parameters: pydantic / DRF serializer / Nest DTO with class-validator `field_decorators` and a `ValidationPipe`;
  - manual: `body_checks` on params with 400/422 `responses`;
  - none.
- **Library:** zod, valibot, yup, joi, superstruct, arktype, typebox, class-validator, pydantic, marshmallow, DRF serializers, cerberus.

### 1.7 config, secrets, feature flags

- **(a) Symbols with `reads`:**
  - `in_place` (`process.env` / `os.environ` read where the value is used);
  - `config_module`: the symbol imports from a module whose symbols read at least 3 env vars and that at least 3 files import, or from a library env schema (t3-env `createEnv`, envalid, `@nestjs/config`, pydantic `BaseSettings`, django settings, dynaconf, python-decouple, environs).
- **(b) Secrets:** secret-named reads (`SECRET|KEY|TOKEN|PASSWORD`) and whether they reach client files. This reuses `client_leaks` and `server_reads`.
- **(c) Flags:** callers of flag SDKs (LaunchDarkly, Unleash, GrowthBook, Flagsmith, PostHog `isFeatureEnabled`, the Vercel `flags` SDK, Statsig, OpenFeature) vs ad-hoc env booleans.

### 1.8 data access (population: production symbols that call a DB instrument or have `raw_sql`/`sql_string_interpolation` sinks)

- **Instrument:** prisma, drizzle, typeorm, sequelize, mongoose, kysely, knex, supabase-js, SQLAlchemy session, Django ORM `.objects`, SQLModel, psycopg, asyncpg, or raw SQL.
- **Layer:** `entry_direct` (an entry point calls the client), `repository` / `service` (the call is in a module that entry points call, within `MAX_HOPS`), or `script`.
- The tenancy filter is reported under `authz` (§1.2).

### 1.9 testing

- **(a) Test files:**
  - placement, naming and fixtures: reuse `map::tests_json`;
  - runner (vitest, jest, mocha, playwright, cypress, pytest, unittest, Django TestCase);
  - mocking style (`mocks`: module mocks, msw, nock, `unittest.mock.patch`, `mocker`, `monkeypatch`, respx, responses);
  - factories (factory_boy, fishery, `@faker-js`).
- **(b) Entry points:**
  - tested: a `test_requests` route matches by `normalize_route`, or its `target` is the route module, or a test file imports the module;
  - required cases covered, where the required cases come from the route's own profile:
    - 401 if its authn variant is not `none`;
    - 403 if authz has a role check;
    - 404 if it responds 404 or has a dynamic segment with a scope check;
    - 400/422 if it validates.
  - Variants are `tested_all_required`, `tested_some`, `tested_none_asserted` and `untested`.

---

## 2. Fact extraction per language (workstreams C and D)

Rules for both workstreams:
- **C edits only `crates/drift-ts/**`; D edits only `crates/drift-py/**`.** Both call `drift_core::practice` helpers.
- Any change to lowering output bumps that language's `LOWERING_VERSION` once per PR. Facts schema 11 is A's bump; C and D do not touch facts.rs.
- Each PR adds an insta test file: `crates/drift-ts/tests/practice_facts.rs` / `crates/drift-py/tests/practice_facts.rs`. Each new field gets a positive case, a negative case and a cap case, plus a determinism test that lowers twice, with 1 and 4 threads, and requires byte-identical output.

### 2.1 In-body auth checks (`body_checks`)

- **TS** (`lower.rs`). Extend the visitor that already records `REJECTS_CALLER`, the one gated by `in_catch == 0 && in_callback == 0 && !continued` (around `lower.rs:2747`).
  - Track local bindings `const x = (await)? f(...)` and destructuring `const { userId } = auth()` with `oxc_semantic` scoping. On a rejecting `if` or early return, record the binding's callee as `source`, the member path read in the condition as `reads`, and the right-hand operand class as `compares`.
  - Add a NotFound outcome: `notFound()`, a 404 response, `TRPCError NOT_FOUND`.
  - Also `routes.rs` `handler_facts` for express/fastify inline handlers. Raw-to-canonical resolution happens in `resolve.rs`, as with `throws`.
- **Python** (`lower.rs`, plus `link.rs` for parameter bindings).
  - Record `if not user...: raise HTTPException(401/403/404)`, `abort(...)`, `PermissionDenied`, `Http404`.
  - A source that is a handler parameter bound to a `Depends(f)` becomes `f`'s canonical id in `link.rs`. Otherwise it is `param:<name>`.
  - Reuse the status readers around `lower.rs:1762` and `:2176`.

### 2.2 Logging calls and logger acquisition (`log_calls`)

- **TS:** in the call visitor, when the last member segment is in `LOG_LEVELS`, or the callee is `global#console.*`, push a `LogCall`.
  - `in_catch` comes from the existing counter.
  - `structured`: any argument is an object literal.
  - `passes_error`: an argument is an identifier bound by the enclosing catch parameter.

  Acquisition needs no new fact. A module-level `const logger = pino()` is already a Const symbol whose `calls` hold `pkg:pino#default`.
- **Python:** the same for `logger.*`, `logging.*`, `structlog`/`loguru`, and `print`. `structured` means keyword arguments other than `exc_info`/`stack_info`, or an `extra=`. `passes_error` means the `except ... as e` name, or `exc_info=True`. `logger = logging.getLogger(__name__)` is already a module Const symbol (`lower_assignment`, `lower.rs:1001`).

### 2.3 Error-to-response mapping (`catches`, `responses`, `handles_errors`)

- **TS:**
  - `visit_catch_clause` (`lower.rs:3314`) builds a `CatchFact` from what the clause throws, returns, logs or responds. The caught class comes from `instanceof` tests inside the clause; otherwise it is `*`.
  - Nest `@Catch(X)` on a class gives `handles_errors`. An Express 4-parameter arrow passed to `app.use` gives `*`. `initTRPC.create({ errorFormatter })` gives `*` on the module symbol.
- **Python:**
  - `except X as e:` gives a `CatchFact`.
  - `@app.exception_handler(X)` / `@app.errorhandler(404)` decorators give `handles_errors` directly. `app.add_exception_handler(X, h)` is resolved onto `h` in `link.rs`. Django/DRF `EXCEPTION_HANDLER` is read from settings (`settings.rs`) onto the named function.

### 2.4 Response models and status codes (`responses`, `inputs`)

- **TS:**
  - Builders: `NextResponse.json(b, { status })`, `new Response`, `Response.json`, `res.status(n).json()`, `reply.code(n)`, `ctx.status =`, `c.json(b, n)` (hono), `throw new HttpException(_, HttpStatus.X)`, Nest exception classes (`NEST_EXCEPTION_STATUS`), `TRPCError({ code })` (`TRPC_CODE_STATUS`), `redirect()`, `notFound()`.
  - Declared models: Nest `@HttpCode(n)` (Declared), `@ApiOkResponse({ type })` / `@ApiResponse` (model).
  - `inputs`: Nest `@Body()` parameter types through `typeres.rs`, tRPC `.input(arg)` canonical in `routes.rs` `procedure_chain`, `X.parse(await req.json())`.
- **Python:**
  - Decorator kwargs `status_code=` / `response_model=` on FastAPI routes (adapters.rs route reading).
  - `JSONResponse(status_code=, content={...})`, DRF `Response(status=)`, `JsonResponse(status=)`, a Flask `return x, 400` tuple, `abort(n)`.
  - `inputs`: the canonical BaseModel annotation of body or query parameters, the DRF `serializer_class`, and `Serializer(data=request.data)`.

### 2.5 Re-exported handlers

- **Mining side, in B: a new `crates/drift-mine/src/entries.rs`.**
  - `entry_symbol(repo, file, entry) -> Option<(&FileFacts, &Symbol)>` first tries a local symbol, as today.
  - Otherwise it follows `Export.origin` for `ExportKind::ReExport`, at most `MAX_REEXPORT_HOPS` (16, as in `drift-ts/src/repo.rs:107`).
  - It is used by `security::inventory_with`, which drops such entries today, by practices and by `card`. Roles and mining are unchanged this round, so the census does not move.
- **TS side, in C:** `export const { GET, POST } = handlers` (Auth.js) records one Const symbol per destructured name with `derives_from` set to `<source>.GET`, so the resolver can reach the origin.
- **Test:** a fixture where `app/api/x/route.ts` re-exports `GET` from `lib/handlers.ts`. The inventory then lists it with the origin's guards.

### 2.6 Raised cap or a concern-specific record

**Decision: concern-specific records, no cap raise.** `calls` are uncapped already; only `order` is capped (`MAX_ORDER` 32). What the concerns lack is **context**: catch, structured, status, the condition's subject. Raising `MAX_ORDER` would change "before" rules and their ids. The records above carry context, under fixed caps.

### 2.7 Testing facts

- **TS:** in test files (`roles::is_test_path`):
  - supertest `request(app).get("/x").expect(401)`;
  - `app.inject({ method, url })`;
  - playwright `request.get` / `page.goto` (route only);
  - direct calls of an imported route handler (`target`);
  - `expect(res.status).toBe(n)` / `.toEqual(n)` / `toHaveStatus(n)` within the same `it`/`test` callback;
  - `vi.mock` / `jest.mock` specifiers resolved to modules;
  - msw `http.get("/api/x")` as `msw:/api/x`.
- **Python:**
  - `client.get("/x")` on a TestClient, httpx, the Django client or the DRF APIClient;
  - `reverse("name")` gives route "";
  - `assert r.status_code == n`, `assertEqual(r.status_code, n)`, `status.HTTP_*` constants;
  - `@patch("a.b.c")`, `mocker.patch`, `monkeypatch.setattr("a.b", ...)` resolved to modules.

### 2.8 Structure fixes

| Fix | Files | Change |
|---|---|---|
| Production vs test dependency edges | `crates/drift-mine/src/map.rs` `package_graph` (B); `crates/drift-ts/src/repo.rs:666` and `crates/drift-py/src/packages.rs` for `dev_only` (C and D) | `package_graph` returns `{prod, test}` edge maps. An edge from a test file (`is_test_path`) or to a `dev_only` package is a test edge. `drift map` JSON gains `dependencies_test` beside `dependencies`, which becomes production only: a JSON meaning change, so it needs a Studio pair. |
| Re-exported handlers | §2.5 | |
| Compose files at any depth | `crates/drift-mine/src/security.rs` `Boundaries::load` (`:146`), `read_compose` (`:183`) (B) | Walk with `ignore::WalkBuilder` to depth 6, skipping hidden dirs and `node_modules`, for `COMPOSE_FILES` names, sorted by path. `build.context` is resolved relative to the compose file's directory. Each source string names its path. |
| FastAPI `Depends` as a guard | `security.rs` `inventory_with` (`:1093`), `EntryRow` (B) | `EntryRow.guards` keeps only wraps where `authenticates` holds, plus Config and AppHook. A new `EntryRow.wrappers` holds the rest. Under `[STRICT]`, an in-repo wrapper with no definition stays a guard only when `grants_by_name` holds (unchanged rule). `guard_gaps` and the card follow. The security JSON shape changes: Studio pair, and a SYNC row. |
| Python namespace that one package makes a regular package (D) | `crates/drift-py/src/` resolver | One contributing distribution ships `ns/__init__.py` (an empty file) while the others are PEP 420 portions. Imports of `ns.<sub>` from that distribution must still resolve to the sibling distribution that ships `ns/<sub>/`. Today they come out unresolved, so a production edge is missing from the map. Fixture: two portions plus one empty `__init__.py`. |
| Env reads through a constant, helper or dict (C, D) | `reads` in both lowerings | Record env names read through a module constant (`KEY = "X"; os.environ[KEY]`), a one-line helper (`def _env(n): return os.environ.get(n)` called with a literal), and a literal-keyed dict of names. Without these, 12 of 20 env names were missed on a pilot package. Each pattern is bounded by caps and has tests. |
| Route templates from f-strings / template literals (C, D) | entry-point route extraction | A route built from an f-string or template literal keeps its literal parts and turns the parameters into `{name}` (for example `/{service_name}/health`), instead of `/?`. |
| Duplicate roles from namespace nesting (B) | `crates/drift-mine/src/roles.rs` | When a role at a deeper directory has exactly the same members as its parent role, keep one: the shallowest. In namespace layouts (`pkg/ns/<pkg>/…`), 59 mined roles were only 34 distinct memberships. Census ids must not change [STRICT]: dedupe only in `map`, `practices` and coverage output, not in mining, unless a fold-rule study admits it. |
| More entry kinds: CLI, queue consumer, LangGraph/agent graph (C, D) | `adapters.rs`, `routes.rs` | argparse/click/typer `__main__`, and TS `bin` scripts → `cli`. Subclasses of a repo queue-consumer base, and Celery/RQ/Bull/kombu handlers → `consumer`. `langgraph.json` / `LANGSERVE_GRAPHS` graph objects → `agent_graph`. Each kind is a new `EntryPoint.kind` value with a fixture. |
| `registry.py`-style modules left out of their directory role (B) | `roles.rs` | Investigate why a module named `registry.py` is excluded from its sibling-files role, and fix the selector or exclusion, with a regression fixture. |

---

## 3. The practice-profile model (workstreams B and E)

**Module layout** (`crates/drift-mine/src/practices/`):
- `mod.rs`: the engine, its types and the JSON;
- `libraries.rs`: the vocabularies;
- one file per concern: `authn.rs`, `authz.rs`, `errors.rs`, `logging.rs`, `api.rs`, `validation.rs`, `config.rs`, `data.rs`, `testing.rs`.

**The concern interface:**

```rust
pub trait Concern {
    fn id(&self) -> &'static str;
    fn population<'a>(&self, cx: &Cx<'a>) -> Vec<UnitRef<'a>>;           // deterministic order
    fn assign(&self, cx: &Cx<'a>, u: &UnitRef<'a>) -> Assignment;           // Known{mechanisms,instruments,label} | None{label} | Unknown{reason, instrument}
    fn promotable(&self, v: &VariantKey) -> Option<(Rule, /*role*/)>;     // §4.5
}
```

`Cx` holds `RepoFacts`, `RepoContext`, the `security::Inventory`, `RepoMap`, `FileKinds`, the declared vocabulary and the entries resolver.

**Population and unit "where."** Each `UnitRef` is either an entry row, a symbol, a catch clause, a test file or a file. It carries:
- its package and its directory chain (`security::role_dirs`);
- its role ids (`map::role_id` of `roles::selectors_for`);
- its entry kind, method, route, language, and file stem.

**Assignment.**
- The key is the sorted, de-duplicated `mechanism:instrument` list, with instruments shortened by `norm_ref`. Split policies are therefore one key.
- Keys with fewer than 2 members fold into a `tail` of their concern. The tail is listed and counts as known if every member is.
- A unit with any unparsed file (`stack_unavailable`) or an opaque instrument is `unknown`, even if other instruments are known [STRICT].

**Coverage per concern:** `(known + none) / total`. `known_only = known / total` is reported beside it. Coverage is computed per package and for the whole repo.

**Sorting.** Variants sort by members (descending), then by key. `none` sorts by its count like any other variant. Unknown is never a variant.

**"What sets it apart."** For variant V, against the dominant variant D (the largest known variant; for D itself, against the rest):
- Candidate attributes:
  - `package:`, `dir:` at each depth, `role:`, `entry:`, `method:`, `stem:`;
  - `route:` first segment, `lang:`;
  - `imports:` a module (internal top 50);
  - `wrap:` an instrument from another concern (cross-concern: "these routes also lack validation").
- For each attribute a, let `k_V` be the members of V that have a (out of `n_V` in V), and `k_D` those of D (out of `n_D`).
- **Statistic:** `separation = wilson_lower_bound(k_V, n_V) − wilson_upper_bound(k_D, n_D)`, with the 95% Wilson interval from `mine::wilson_lower_bound` and a new upper-bound twin.
- Report attributes with `separation > 0.25`, at most 3, ordered by separation (descending), then `purity = k_V / (k_V + k_D)` (descending), then attribute string.
- The text reads "9/9 of B under app/api/webhooks vs 0/170 of A". It is a property of the counts, deterministic, and gives no verdict.

**Examples and exceptions.**
- Examples are V's members closest to the medoid: the most common attribute signature, then by path. There are 3 of them, quotable through `security::source_line`.
- Exceptions of V are the members of other variants, `none` or unknown that sit in V's dominant places: (package, dir) roles of at least `MIN_ROLE_SIZE` where V holds at least 80%.
  - Broadest first, as in `security::guard_gaps`.
  - Each exception is listed with the variant it uses.

**Per package and cross-package.**
- `by_package` gives the same profile per `FileFacts.package`.
- `divergence` lists packages whose dominant known variant (at least 60% of the package) differs from the repo-wide dominant one. This is the "FastAPI services do X, the Next app does Y" line.

**Convention links.** A variant is linked to conventions whose `Rule` matches its instrument (`wrapped_by` any_of, `calls`, `throws`, `avoids`) and whose role covers its examples. This generalises `security::link_conventions` (`:393`).

---

## 4. Outputs (workstreams B and F)

1. **CLI:** `drift practices [--concern ID] [--package P] [--path FILE] [--json] [--all-variants]` (`crates/drift-cli/src/main.rs` `Command::Practices`, new `crates/drift-cli/src/practices.rs`).
   - It reads facts the way `drift map` and `drift card` do (#167): no writes, never fails a check, exit code 0.
   - Text output is capped: 5 variants per concern, then "and N more".
2. **MCP:** `drift_practices` with optional `concern`, `package` and `path`, added to `base_tools` (`crates/drift-cli/src/mcp.rs:46`).
   - Description: "What this codebase does for each cross-cutting concern, with each variant's share, where it is, and an example to copy. Facts, not rules."
   - Update the "seven MCP tools" count in the README, the mcp help and `tests` (#167 pinned it).
3. **Card and hooks.**
   - `card.rs` gains a "Practices here" section of at most 5 lines: for each concern that has units in the file, the file's own variant, plus the package's dominant variant and an example when they differ.
   - Hooks (`crates/drift-cli/src/agent.rs` priming) add one line per concern for the target file's package: `drift: practices in <package> (facts, not rules): auth withWorkspace() 95% (copy ...); errors ...`. It is capped at 5 concerns and labelled descriptive. A new hook opening means `apps/studio` `coverage.test.ts` must recognise it.
   - Concerns where nothing is known are not shown.
4. **Studio** (SYNC.md rule): see workstream F.
5. **Promotion:** `drift practices promote <P-id> [--block] [--role R-id]`.
   - It writes accepted conventions to `.drift/conventions.yaml` through the existing `policy` path, with `Convention.promoted_from_practice: Option<String>` (the variant id, not part of the convention id, omitted when None).
   - **Rule mapping.** Every target is an existing `Rule`; there are no new rule kinds:
     - wrap or decorator → `WrappedBy`;
     - body_call → `Calls`;
     - errors throw-family → `Throws`;
     - logging repo-logger → `PrefersLibrary{logging}` or `Avoids{import:pkg:<other logger>}`;
     - config module → `Avoids{env}` on roles outside the config module;
     - validation → `Control{validates}`.
   - A split policy promotes to one convention per instrument, all sharing the same `promoted_from_practice`.
   - Variants with no mapping show `promotable: null` and the command refuses with "descriptive only".
   - **Gates are unchanged:**
     - tiers come from `tier.rs`;
     - Python advises only (D7);
     - `--block` needs `MIN_BLOCK_ROLE_SIZE`;
     - `check`, the lock baseline and exemptions run as for any accepted convention;
     - agents see it under the existing admission rules.

---

## 5. Measurement (workstream G)

**Measures:**
- **M-cov.** Concern coverage, `(known + none) / total`, and `known_only`. Reported per concern, pooled, and as the per-repo median. Target ≥ 90% per concern (pooled and median).
- **M-acc.** Variant-assignment accuracy, from blind spot-check labels.
- **M-apart.** The share of `sets_apart` lines labelled true.
- **M-agent.** Secondary: the share of repos with at least one practice line at the root. Target ≥ 90%, against 16.7% shown today.

**Rubric** (`eval/study/RUBRIC-practices-v1.md`). Per sampled unit, the labeller sees the unit's source (handler plus one hop into each instrument's definition), the concern definition and the assigned label. Labels:
- **CORRECT:** does what the label says, and that is the concern's relevant behaviour.
- **WRONG_VARIANT:** does the concern another way.
- **MISSED:** does the concern but was assigned `none` or `unknown`.
- **FALSE_NONE:** assigned `none` but does it. Kept apart from MISSED, because it is the dumb-classifier failure.
- **NOT_IN_POPULATION.**
- **UNSURE.**

Accuracy = CORRECT / all labelled. UNSURE and NOT_IN_POPULATION count against it [STRICT].

**Sampling.** Stratified by repo × concern × variant, at most 10 units per concern per repo. Each variant with at least 5% share is sampled at least twice, `none` and unknown at least twice each. Seeded with `lib.mjs shuffle`.

**Labelling.** A/B labellers, with C on disagreement, as dev4-check. Prompts are rendered with `lib.mjs rubricText` plus `labellerCard`; G adds a `practice` item kind there (no hand-written renderer). Leak checks as in the brief.

**Sets.**
- **Build set** (design and tuning allowed): dev clones ts 16, py 6, py2 12, and apps-build 12. dev3 and dev4 aggregates only.
- **Owner's pilot repo:** run only by the gc-pilot agent, at the frozen binary, reporting M-cov per concern and M-acc aggregates. Nothing is quoted.
- **Fresh blind set `apps13`:**
  - `select-apps.mjs` with a new public seed and a new secret, committed as a sha256 before the draw;
  - exclusions as apps11, plus both apps11 halves;
  - 18 repos, operator-only, under `scratchpad/apps13-blind*`.

**Pre-registration** (`eval/study/PREREG-R13-practices.md`, committed before the draw and before the freeze):
- the frozen binary and census commit;
- the measures above;
- the bars:
  - M-cov ≥ 90% per concern, pooled, and median per repo;
  - M-acc point ≥ 90% with Wilson lower bound ≥ 80%, n ≥ 30 labelled units per concern;
  - FALSE_NONE ≤ 5%;
- the sampling seed and the deviation rules.

No claim of "≥ 90%" is made from build-set figures.

**Eval code:**
- `eval/study/practices.mjs`: `run` (calls `drift practices --json` one repo at a time), `sample`, `score`;
- `practices.test.mjs`;
- `apps-coverage.mjs` gains M-cov columns.

---

## 6. Workstreams, slices, order

### 6.1 Workstreams (today)

**A. Contract** (owner: integration, slot 1). About 600 LOC.
- `crates/drift-core/src/facts.rs` (§0.2), new `crates/drift-core/src/practice.rs`, `crates/drift-core/src/lib.rs`.
- Fixtures under `crates/drift-mine/tests/fixtures/practices/`.
- Empty `practices` module skeleton plus JSON types in `crates/drift-mine/src/practices/mod.rs`, with a golden.
- `apps/studio/src/shared/contract/drift.ts` types (with F).
- Tests: §0.2 determinism, the schema-10 round-trip, the caps, the validators.
- Merges first. C, D, B and F branch from it.

**B. Engine plus CLI/MCP** (slot 1, after A). About 2,000 LOC.
- `practices/mod.rs`: engine, sets_apart, by_package, divergence, links.
- `crates/drift-mine/src/entries.rs`.
- `security.rs`: guard classification, `EntryRow.wrappers`, compose walk.
- `map.rs` `package_graph` split; `card.rs` section.
- `crates/drift-cli/src/{main.rs, practices.rs, mcp.rs, agent.rs}`; `policy.rs` `promoted_from_practice`.
- Tests:
  - insta goldens on the 3 fixtures;
  - determinism (shuffle the file order and get the same bytes);
  - a mutation check for each `[STRICT]` branch: unknown dominates known; FALSE_NONE guard; guard filter;
  - CLI tests through `DRIFT_TEST_BIN`.

**C. TS extractors** (slot 2). About 1,800 LOC.
- Files: `crates/drift-ts/src/{lower.rs, routes.rs, resolve.rs, typeres.rs, repo.rs}` and `crates/drift-ts/tests/practice_facts.rs`. TS `LOWERING_VERSION` 38.
- Order inside C: body_checks + headers + route_matchers + destructured exports (for slice 1), then catches/responses/handles_errors, then log_calls, then inputs, then testing facts, then `dev_only`.

**D. Python extractors** (slot 2, alternating with C). About 1,500 LOC.
- Files: `crates/drift-py/src/{lower.rs, link.rs, adapters.rs, settings.rs, packages.rs, signals.rs}` and `crates/drift-py/tests/practice_facts.rs`. Python `LOWERING_VERSION` 18.
- Same order as C.

**E. Concern classifiers and vocabularies** (slot 1, merged into B's branch). About 2,000 LOC.
- `practices/libraries.rs` and the 9 concern files.
- Each concern lands behind the engine as soon as its facts exist in the fixtures.
- Unit tests per concern on fixture snippets.
- The vocab-test constraints hold: no `_WORDS` consts; `grant::` is not read.

**F. Studio Practices view** (no cargo). About 1,200 LOC TS.
- `apps/studio/src/features/practices/{PracticesView.tsx, model/, index.ts}`: concern list with coverage bars, variant stack per concern, a where/sets-apart panel, examples opening the code drawer, a Promote action calling `drift practices promote`.
- The electron main runs the CLI.
- `coverage.ts`: the new subcommand, the MCP tool and the hook opening.
- Security view: `wrappers` vs `guards`. Map view: `dependencies_test`.
- `SUPPORTED_FACTS` [4..11], fixtures regenerated, SYNC.md rows.
- Gates: typecheck, lint, vitest, build.

**G. Measurement and the fresh blind set** (no cargo). The `eval/study` files of §5. The pre-registration is committed before the freeze and before the `apps13` draw.

### 6.2 Slices (each shippable and measured on the build set by M-cov and an in-sample spot-check)

| # | Slice | Reused | New | Size | Risks |
|---|---|---|---|---|---|
| 0 | Contract plus structure fixes | `Export.origin`, `COMPOSE_FILES`, `authenticates`, `package_graph` | facts schema 11, entries resolver, guard filter, compose walk, test edges | M | The guard filter changes `drift security` and `guard_gaps`, so `security --json` diffs on the dev clones list every changed entry [STRICT]. |
| 1 | **Auth** (authn plus authz/tenancy, in-body checks, split auth as one key) | `security::Inventory`, `authenticates`, `callee_is_guard`, `library_guard`, router deps in `link.rs`, `REJECTS_CALLER` visitors | body_checks, headers, route_matchers, engine, CLI/MCP/card/Studio | L | Middleware matcher semantics (Clerk public-route lists) give a false "covered". Under `[STRICT]`, an unproven matcher coverage counts as `unknown`, never as a guard. |
| 2 | Errors | `throws`, lineage_exception, `after_continuation` | catches, responses, handles_errors | M | Framework default handlers that are not in the repo: `bubble` is labelled as a fact, not as a gap. |
| 3 | Logging | `calls`, module Const symbols, the `LIBRARY_GROUPS` logging group | log_calls | S–M | A level-named method on a non-logger (`map.info`): only a proven logger origin is known. |
| 4 | API/response | entry points, `args` keys | responses.model/keys | M | The key fragments: status and shape stay attributes. |
| 5 | Validation | `validates`, `INPUT_STEPS`, `field_decorators` | inputs | S–M | Input that is unknown, not absent: kept unknown. |
| 6 | Config/secrets/flags | `reads`, `server_reads`, `client_leaks` | flag vocabulary | S | Config-module heuristic thresholds (3/3) are tuned in sample only. |
| 7 | Data access | `sinks`, `calls`, `security::Index::reaches` hops | DB vocabulary, layer | S–M | Repository detection through hops. |
| 8 | Testing | `map::tests_json`, `has_test` | test_requests, mocks, required-case join | M | Route matching of tests is literal-only; `reverse()` routes stay unmatched (unknown). |

### 6.3 Order and build slots (at most 2 cargo builds)

- **Slot 1** (drift-core, drift-mine, drift-cli):
  - A (one build), merge;
  - then B on `ws/practices-engine`;
  - E commits to the same branch, so B and E share one builder at a time;
  - then B's CLI work.
- **Slot 2** (parsers): C and D alternate on their own branches (`ws/practices-ts`, `ws/practices-py`), each slice's facts in turn: C1, D1, C2, D2 and so on.
- **The slot lock:**
  1. Each agent takes the slot with `flock /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/shared/slot-N.lock` around its build command.
  2. It still checks `pgrep -c -x cargo < 2`, the free-memory floor and the disk floor first.
  3. It uses `build-verified.sh` with its own CGU (next free: 94 upward, assigned by the lead).
- F and G run in parallel from the moment A merges: npm and node only.
- **Dependencies:**
  - B depends on A only, through the fixtures;
  - C and D depend on A only;
  - the real-facts integration (B with C/D) happens per slice by merging main into B;
  - G's pre-registration must be committed before the binary freeze; the `apps13` draw comes after the freeze.
- **Census.** Practices changes no mining. Every PR runs `census --json --max 15` before and after on the dev clones and must show zero changed ids. Any change is a bug [STRICT]. The security and map JSON diffs are reported separately.

---

## 7. What happens to rule mining and the show policy

Nothing is removed.
- **Mining, unchanged:** `mine.rs`, the Wilson/lift gates, the drafts, `show.rs`, `admission.rs` and the rank caps keep producing `census`/`init` proposals as today, and the census stays byte-identical.
- **Practices is a second, always-on reader of the same facts.**
- **Variant sets:** `variant_set` (`mine.rs:7020`) keeps its `split:` evidence, and variants link to mined conventions (§3).
- **Enforcement stays where it is:** `check`, hooks, PR mode and SARIF enforce only accepted conventions, under the existing tier and admission gates. Promotion is a person's accept, like `promoted_from_hidden`.
- **The show policy** still decides only which mined proposals are listed. It never touches practices.
- **Later rounds** may use high-share practice variants as a candidate source for mining. Such candidates go through the same gates and the same blind measurement before anything reaches agents unvetted (D1/D12 unchanged).

## 8. Next round (design only)

These are not in today's scope. The facts named are the ones each would need.
- **Outbound calls:** HTTP clients, timeouts and retries (`args` keys `timeout`/`retry`, plus a `responses` analogue for clients).
- **Jobs and queues:** BullMQ, Celery, Inngest, Trigger.dev; entry kinds exist (`job`).
- **Frontend data fetching:** the `LIBRARY_GROUPS` "data fetching" group, server components vs client fetch.
- **State and design system:** the `renders` of design-system packages.
- **Hygiene:**
  - duplicate libraries for one job (`LIBRARY_GROUPS` across packages);
  - duplicated helpers (name plus call-signature clusters);
  - escape hatches (`uses_any`, `drift-ignore`, `# type: ignore`).
- **Declared vs actual:** AGENTS.md, CLAUDE.md and lint configs (`RepoFacts.lint`) against practice variants.
- **Change over time:** which variant new code adopts (`cochange.rs` / history windows, by first-commit date per unit).

### Critical files for implementation
- /home/user/drift/crates/drift-core/src/facts.rs
- /home/user/drift/crates/drift-mine/src/security.rs
- /home/user/drift/crates/drift-ts/src/lower.rs
- /home/user/drift/crates/drift-py/src/lower.rs and /home/user/drift/crates/drift-py/src/link.rs
- /home/user/drift/crates/drift-cli/src/mcp.rs and /home/user/drift/apps/studio/docs/SYNC.md
---

## 9. Decisions after the external R&D review (2026-11-09)

An external research-only review of this plan was taken in. The lead's decisions:

1. **Route recipe first.** The default output for people, agents and Studio is a recipe per package × entry role: authn, authz, validation, errors and api, each with the top 2 variants, a file to copy, the `none` count and what differs where. The concern table is the drill-down. `practices --json` gains `recipes[]`, an unexplained-split finding with a stable `kind`, and a `config_hint` on each unknown instrument. These five concerns are primary; logging, config, data_access and testing are preview.
2. **Coverage is not only known-or-none.**
   - `known_only`, FALSE_NONE and variant recall are co-primary metrics.
   - The release gate is FALSE_NONE ≤ 5% on authn.
   - Each concern gets a pre-registered predicted value, replacing the uniform 90%.
   - A failed bar is published.
3. **M-acc arithmetic.**
   - n ≥ 100 labelled units per concern, from ≥ 30 repos;
   - a repo-cluster bootstrap as the primary interval;
   - `none` oversampled to ≥ 60 for authn and validation;
   - a variant-recall arm;
   - a human gold subset of about 100 units, pending a funding decision by the owner.
   - apps13 must have ≥ 30 repos.
4. **`sets_apart` guards.**
   - n_V ≥ 5;
   - a multiplicity correction, or structural attributes tested first;
   - the shallowest of nested directories only;
   - no tautological `imports:` attribute.
   A variant with no separating attribute is reported as an unexplained split and ranked first.
5. **The auth model.** authn, authz and tenancy are three separate checkpoint chains. A checkpoint enforces only when rejection is proven or known from the vocabulary. Unreadable matchers give `unknown`.
   - Split auth is either a conjunction or a disjunction (a policy with alternatives).
   - Service-to-service auth is its own caller class: `BodyCheck.compares: "env"` and webhook verifier body checks.
   - Nest: the `UseGuards` argument and `APP_GUARD` are recorded in TS `decorator_args`, with no wrap change.
   - Django and DRF settings, and Flask `before_request`, are already folded into wraps; in-repo rejecting `MIDDLEWARE` is added.
6. **Promotion is deferred.** No `practices promote` mapping to `WrappedBy` this round. A later round adds a `Practice{concern, any_of}` rule kind, checked by the classifier: it fires only on units known to be in another variant or `none`, only on new or changed units, after a history replay and a person's accept. The Studio view is read-only this round.
7. **Step 0 agent proof (workstream H).**
   - Before any consistency claim, measure control-arm conformance on mechanically generated new-unit tasks, on a strong and a cheap model, capped at USD 25. If the strong model's control conformance is ≥ 90%, the consistency claim is dropped for strong models and the pitch is cost and exhaustiveness.
   - Profile hook latency: about 1 s measured against the README's 0.02–0.10 s.
   - Pre-register the three-arm A/B: bare; Drift hooks plus MCP; the same practice text in AGENTS.md. Its primary endpoints are conformance and total tokens.
8. **Stopped.**
   - Show-table regeneration and family tuning;
   - more default-tier blind draws;
   - new layering mechanisms;
   - history-recall studies.
   The Action's security step stays opt-in until the guard fixes are measured.
9. **Next rounds, ranked.**
   1. which variant new code adopts (current vs dominant);
   2. two libraries for one job;
   3. escape hatches;
   4. lint config vs practice;
   5. outbound HTTP timeouts and retries;
   6. jobs and queues.
   Frontend data and state, and AGENTS.md prose vs practice (an optional LLM step outside the core, reviewed by a person), come after.
