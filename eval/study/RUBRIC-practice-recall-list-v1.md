# Labelling rubric: the mechanisms a package uses (list step)

This is the first step of the variant-recall arm of the practice-map measures (PREREG-R13-practices.md §3.4, §6.4; PLAN-R14 WS-F F6). The lister is shown one package of a repository and the five primary concerns, and **never** any output of the tool. The lister lists every distinct mechanism the package uses for each concern. A matcher then marks each listed mechanism as found or missed by the tool (`RUBRIC-practice-recall-match-v1.md`). Rubric id `practice-recall-list`; lib.mjs `APPROVED_PRACTICE_RUBRICS` pins the labeller-facing text.

<!-- study-only -->
Variant recall = FOUND / every mechanism listed, PARTIAL counted as not found (practices.mjs recallScore).
<!-- /study-only -->

## The setting

You are shown one package (a directory with its own manifest) of a repository. For each of five cross-cutting concerns, find every distinct way the package's production code handles it, and list each one with an example.

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

## What to do

1. **Find the units of each concern** in the package's production code (not tests, fixtures, examples or generated code): its entry points (HTTP handlers, server actions, RPC and GraphQL resolvers, jobs) for authn, authz, validation and api; entry points and exported services for errors.
2. **Open enough of them** to see every way they handle the concern: at least five units per concern when the package has that many, chosen across its directories, and every unit that looks different from the others. Open one hop into each instrument (the wrapper, guard, dependency, schema or error class), to see what it does.
3. **List each distinct mechanism once**, as `{ "mechanism": ..., "instrument": ..., "example": "<file>" }`:
   - `mechanism`: how it is applied (`wrap`, `decorator`, `dependency`, `middleware`, `body check`, `explicitly public`, `try/catch`, `app handler`, `throw`, `schema`, `typed model`, `manual check`, `response builder`, ...);
   - `instrument`: what does it, as the code names it, with its file when it is defined in the repository;
   - `example`: a repo-relative file where a unit uses it.
   Two units that combine the same instruments the same way are one mechanism. A combination that recurs (middleware plus a check in the body) is one mechanism, written with both instruments. Units that do nothing for the concern are a mechanism too: `{ "mechanism": "none", "instrument": "none", "example": ... }`.
4. A concern the package has no units of gets `[]`.

List every file you opened in `checked`, as repository-relative paths.

## Output

One JSON object per package, one per line (JSONL). The example is made up: the repository `acme-shop` does not exist.

```json
{"uid": "acme-shop/recall/pkg-1a2b3c4d", "rubric": "practice-recall-list",
 "concerns": {
   "authn": [{"mechanism": "wrap", "instrument": "lib/auth.ts#withShopUser", "example": "api/orders/list.ts"},
             {"mechanism": "none", "instrument": "none", "example": "api/health/route.ts"}],
   "authz": [{"mechanism": "body check", "instrument": "session.user.role", "example": "api/admin/users.ts"}],
   "validation": [{"mechanism": "schema", "instrument": "zod", "example": "api/orders/create.ts"}],
   "errors": [{"mechanism": "try/catch", "instrument": "NextResponse.json", "example": "api/orders/list.ts"}],
   "api": [{"mechanism": "response builder", "instrument": "NextResponse.json", "example": "api/orders/list.ts"}]},
 "checked": ["api/orders/list.ts", "lib/auth.ts", "api/health/route.ts", "api/admin/users.ts", "api/orders/create.ts"],
 "reason": "Opened the route handlers under api/ and the auth wrapper; the health route has no auth by design."}
```

| Field | Required | Values |
| --- | --- | --- |
| `uid` | yes | as given on the card |
| `rubric` | yes | `"practice-recall-list"` |
| `concerns` | yes | an object with exactly the five keys `authn`, `authz`, `validation`, `errors`, `api`, each a list of `{ mechanism, instrument, example }` (`[]` when the package has no units of it) |
| `checked` | yes | the repo-relative files you opened |
| `reason` | yes | one or two sentences on what you opened |

List what the code does. There is no expected number of mechanisms.
