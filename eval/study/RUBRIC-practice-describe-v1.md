# Labelling rubric: what a unit does for a concern (describe step)

This is the first of the two labelling steps of the practice-map accuracy measure (PREREG-R13-practices.md, PLAN-R14 WS-F F6). The labeller is shown the unit and the concern, **never** the tool's assignment, and writes what the unit does. The second step (`RUBRIC-practice-match-v1.md`, a different labeller) compares that description with the assignment. Rubric id `practice-describe`; lib.mjs `APPROVED_PRACTICE_RUBRICS` pins the labeller-facing text.

<!-- study-only -->
Why two steps: a labeller shown the assigned label tends to confirm it. The label is derived in code (lib.mjs derivePracticeLabel) from the assignment, this description and the matcher's `same`.
<!-- /study-only -->

## The setting

You are shown units of code from a repository, one at a time: an HTTP handler, a function, a catch clause or a test file. For each one you are told a **concern**, a cross-cutting thing code does or does not do (authentication, error handling, logging, ...), and which kind of unit the concern is about. Read the code and say what this unit does for that concern.

## The concerns

The concern and its population are part of the card. What counts as "doing the concern":

- **authn** (Authentication), population: production entry points (HTTP handlers, server actions, GraphQL and RPC resolvers, jobs). Doing it: the unit establishes or requires who the caller is before acting: an auth wrapper or decorator, a guard dependency (FastAPI `Depends(get_current_user)`, Nest `@UseGuards`), middleware that provably covers the route, an in-body check that rejects an unauthenticated caller, or an explicit public marker (say it is explicitly public, as a mechanism). A dependency that does not authenticate (a database session) is not authentication.
- **authz** (Authorization and tenant scoping), population: entry points that authenticate. Doing it: a role or permission check (a privileged wrapper, an in-body check on a role or permission, a policy-library call) and/or a tenant scope (an organisation, workspace or team id from a header, a session claim or a path parameter), enforced by a check or by a scoped query.
- **errors** (Error handling), population: entry points (how errors become responses) or exported services (what they throw and how they catch). Doing it: a wrapper that maps errors to responses, an app-level handler that covers the thrown class, a try/catch that responds, a framework HTTP error thrown, or none of these: errors bubble to the framework default (describe that as DOES with mechanism `bubble`, instrument the framework).
- **logging** (Logging and observability), population: functions with a log-call candidate, catch clauses, or entry points. Doing it: calls to a real logger (console, print, a library logger, the repository's own logger module), structured or message style; for catch clauses, logging or reporting the error; for entry points, logging or tracing at all. A method named like a level on something that is not a logger (`map.info`) is not logging.
- **api** (API design and responses), population: HTTP entry points. Doing it: the response builder used, a declared response model, and the error envelope (the keys of error bodies).
- **validation** (Input validation), population: entry points that read request input. Doing it: a schema at the boundary (zod, pydantic, class-validator DTOs, tRPC `.input`), typed model parameters that the framework validates, manual checks that reject bad input with 400/422, or none.
- **config** (Config, secrets, feature flags), population: functions that read environment variables or configuration. Doing it: reading `process.env` / `os.environ` in place, or through a config module or a library settings schema; for flags, a flag SDK or an ad-hoc environment boolean.
- **data_access** (Data access), population: production functions that call a database client or run SQL. Doing it: the client or ORM used (Prisma, Drizzle, SQLAlchemy, the Django ORM, raw SQL, ...) and where the call sits (directly in the entry point, in a repository or service module, or in a script).
- **testing** (Testing practice), population: test files, or entry points (whether they are tested). Doing it: the runner, mocking style and fixtures of a test file; for an entry point, whether a test requests its route or calls its handler, and which status codes the tests assert.

## What to open before deciding

1. **The unit's file,** at the line shown. Read the whole unit.
2. **One hop into everything it uses for the concern:** the definition of each wrapper, decorator, dependency, guard, logger, error class or client, to see what it does. One hop is enough.
3. **For route-level mechanisms** (middleware, router dependencies, route matchers), the file that applies them, to check that they cover this unit.
4. Before saying NONE, search the unit's file and its one-hop definitions for the usual instruments of the concern.

List every file you opened in `checked`, as repository-relative paths, the unit's file first.

## What to write

Decide `does`, in this order:

1. **NOT_IN_POPULATION:** the unit is not the kind of unit the concern is about (not production code where production code is meant; not an entry point where entry points are meant; it reads no input where "entry points that read input" are meant).
2. **DOES:** the unit does the concern. List every **mechanism** it uses, each as `{ "mechanism": ..., "instrument": ... }`:
   - `mechanism`: how it is applied, in a word or two: `wrap`, `decorator`, `dependency`, `base class`, `middleware`, `config`, `body call`, `body check`, `explicitly public`, `try/catch`, `app handler`, `throw`, `logger call`, `schema`, `typed model`, `manual check`, `env in place`, `config module`, `orm`, `raw sql`, `test request`, ... (another word if none fits);
   - `instrument`: what does it, as the code names it, with its file when it is defined in the repository (`lib/auth.ts#withWorkspace`, `fastapi HTTPException`, `pino`, `zod`).
   A unit that uses two mechanisms (middleware plus a check in the body) lists both.
3. **NONE:** the unit does not do the concern, in its body or one hop from it.
4. **CANNOT_TELL:** you opened what this rubric asks and the code does not say: the instrument is opaque (generated, dynamic, from outside the repository with no clear meaning), or the code does not parse as written.
5. **UNSURE:** none of the above fits; say why in `reason`. Use it rarely.

Write `description`: one or two sentences, in your own words, of what the unit does for the concern, citing files.

## Output

One JSON object per unit, one per line (JSONL). Field order does not matter. The examples below are made up: the repository `acme-shop` does not exist.

```json
{"uid": "acme-shop/authn/3f9a01c2", "rubric": "practice-describe", "does": "DOES", "confidence": "high",
 "mechanisms": [{"mechanism": "wrap", "instrument": "lib/auth.ts#withShopUser"}],
 "checked": ["api/orders/list.ts", "lib/auth.ts"],
 "description": "list.ts exports GET = withShopUser(handler); withShopUser in lib/auth.ts reads the session and returns 401 without one.",
 "reason": "Opened the handler and the wrapper's definition; nothing else authenticates."}
{"uid": "acme-shop/authn/77b0d413", "rubric": "practice-describe", "does": "NONE", "confidence": "high",
 "checked": ["api/health/route.ts"],
 "description": "The health route returns a constant; nothing in it or its imports reads a session or a token.",
 "reason": "Searched the file and its two imports for session, token and auth calls."}
```

| Field | Required | Values |
| --- | --- | --- |
| `uid` | yes | as given on the card |
| `rubric` | yes | `"practice-describe"` |
| `does` | yes | `DOES`, `NONE`, `CANNOT_TELL`, `NOT_IN_POPULATION` or `UNSURE` |
| `mechanisms` | if DOES | `[{ "mechanism": ..., "instrument": ... }]`, every mechanism the unit uses for the concern |
| `description` | yes | what the unit does for the concern, in your words |
| `confidence` | yes | `high`, or `low` when you hesitated (name both readings in `reason`) |
| `checked` | yes | the repo-relative files you opened, the unit's file first |
| `reason` | yes | one or two sentences on what you opened and why you decided |

Describe each unit on its own. There is no expected distribution of answers.
