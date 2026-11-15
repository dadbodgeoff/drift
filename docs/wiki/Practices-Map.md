# Practices Map

This page explains `drift practices`: the map of what the codebase does for each cross-cutting concern, how to read its states, reasons and obligations, how to declare what Drift cannot classify alone, and what the hints are. It is for engineers and reviewers who want to see how consistently routes authenticate, authorize, validate and handle errors, and for anyone who needs to read an `unknown` or a `none` correctly.

The practice map states facts, not rules. It is read-only, exits 0, enforces nothing and never blocks. (There is no `drift practices promote`: a practice cannot yet be turned into a checked convention, and `promotable` in the JSON is always null.)

## Concerns and units

| Concern id | Title | Unit | Status |
| --- | --- | --- | --- |
| `authn` | Authentication | entry point | in the recipe |
| `authz` | Authorization and tenant scoping | entry point | in the recipe |
| `errors` | Error handling | entry point | in the recipe |
| `api` | API design and responses | entry point | in the recipe |
| `validation` | Input validation | entry point | in the recipe |
| `logging` | Logging and observability | symbol | preview |
| `config` | Config, secrets, feature flags | symbol | preview |
| `data_access` | Data access | symbol | preview |
| `testing` | Testing practice | entry point | preview |

Preview concerns appear in a recipe only where at least 60% of the package does the same. A concern's *unit* is what Drift counts: for authentication it is each request entry point (HTTP route, server action, GraphQL resolver, RPC, job). A router mounted more than once is one unit per mount, each with that mount's guards. Message consumers are listed apart and counted in no concern, because a queue feeds them and no caller signs in.

## Running it

```bash
drift practices
```

The default text is a recipe per kind of entry point in each package, and the findings. Other views:

```bash
drift practices --all
```

```bash
drift practices --concern authn --all
```

```bash
drift practices --package apps/web
```

```bash
drift practices --path app/api/search/route.ts
```

```bash
drift practices --json
```

`--all` gives every concern's variant table; `--concern` takes `authn`, `authz`, `errors`, `logging`, `api`, `validation`, `config`, `data_access` or `testing`; `--units` (with `--json`) lists every unit with its assignment, for measurement. On the example fixture used in [Getting Started](Getting-Started):

```
Practices (facts, not rules): 212 unit(s) across 9 concern(s), 100% told: known, identified, or nothing found in what Drift read.

Findings:
  - authn none in .: 4 unit(s) with no guard found in what Drift read (e.g. app/api/new/route.ts:1 GET)
  - validation none in .: 1 unit(s) with reads input, nothing validates it (e.g. app/api/search/route.ts:2 GET)

Recipes (what new code of each kind does here):
  http entry points in . (43):
    authn: wrap withAuth 38/43 (copy app/api/r00/route.ts:2 GET); none 4/43 (nothing found in what Drift read)
    authz: none 38/38 (nothing found in what Drift read)
    errors: bubble framework_default 43/43 (copy app/api/health/route.ts:1 GET)
    api: builder Response(new) 42/43 (copy app/api/health/route.ts:1 GET)
    validation: none 1/1 (nothing found in what Drift read)
```

The `authz: none 38/38` line is the kind of answer to treat as a finding to check: it means nothing was found in what Drift read, not that the routes are open. See [How Drift Works](How-Drift-Works).

## Variants and their share

For each concern, Drift groups the units into *variants*: "wrap `withAuth`", "builder `Response(new)`", "bubble `framework_default`". Each variant has an id (`P-0f0acb`), its share, where it is (packages and directories), what sets it apart, and an example to copy. Alternatives count together, and a split (for example most routes behind one guard, one directory behind another) is shown as one policy with its alternatives, decided package by package. The top two variants that each hold at least 20% of a concern, with nothing that sets the second apart, are reported as an unexplained split.

## States

Each unit's assignment is one of:

| State | Meaning |
| --- | --- |
| a variant (known) | the unit does the concern in this way, and the instrument was read |
| `identified` | authentication only: the caller is identified and no one is turned away (counted apart; see below) |
| `none` | nothing found in what Drift read: "no guard found in what Drift read", "no role check, tenant scope or owner scope found in what Drift read", "reads input, nothing validates it", "untested". Each `none` unit of authentication or authorization carries its `basis`: what was read and what Drift saw and did not read |
| `unknown` | what the unit does cannot be told. Counted against coverage, never hidden. The reason says why |

Coverage is `known + identified + none` over all units, that is, the units Drift can tell something about (the text says "told: known, identified, or nothing found in what Drift read"). A concern is "at target" at 90%.

### Authentication variants

Besides a guard that turns callers away (a wrapper, decorator, base class, dependency, setting, app hook, a middleware, a body check, a body call proven to refuse), Drift records `opens` (declared public: `AllowAny`, `@Public()`, a middleware's public list; or, where nothing else was found, a liveness or readiness probe: a `GET` on `/health`, `/healthz`, `/livez`, `/readyz`, `/health/live` or `/health/ready`, alone or under a prefix, whose handler reads no request input. The path and the absence of input decide, never the handler's name; it is recorded as `opens probe` rather than as having no guard), `identified` (below), and `service_auth` (a webhook signature verifier or a check against a secret from the environment: a service caller, not a user).

**`identified`.** Authentication that identifies the caller and turns no one away (a session is read, or DRF `authentication_classes` are set, but nothing rejects a caller) is its own state, `identified`. It is counted apart from `known` and from `none`, never offered as a recipe to copy, and worded "identified by getServerSession, turns no one away". In JSON the variant's `kind` and the unit's `assignment` are `identified`, the population and summary carry an `identified` count, and the variant's key keeps `identifies:<instrument>`. `drift security` lists such a route as having no guard, identified by the same instrument.

**What `none` rests on.** A `none` unit of authentication or authorization says what was read and what Drift saw and did not read, in words from one place on every surface: `none: no guard found in what Drift read (2 not read: svc/app/broken.py (skipped by the scan), lookup from company_auth)`. In `drift practices --json --units` it is the unit's `basis`: `bodies` (how many bodies were read), `followed` (the repository's functions followed from the entry point) and `not_read`, a list of `{kind, what, why}` with kinds `package_function`, `depth_limit`, `not_modelled`, `description` and `file`; a variant's list is the union of its members'. Each line names only what its own units did not read; a line for several units says `N not read across K units`, and a finding counts only its own package's units. See [How Drift Works](How-Drift-Works#what-a-none-or-internal-carries). The keys and `P-` ids of `none` variants are unchanged.

### Reasons a unit is `unknown`

| Reason | Meaning |
| --- | --- |
| `unparsed` | a file of the unit was not parsed (skipped, parse errors, stack unavailable) |
| `opaque_wrapper` | a wrapper or guard Drift cannot see into |
| `unresolved` | an instrument that does not resolve |
| `no_symbol` | the entry point's symbol was not found |
| `dynamic` | dynamic code (computed callees, spreads) |
| `body_unreadable` | the body awaits a call whose body cannot be read; it may be the check |
| `not_followed` | a value that would decide the concern (a tenant id from a header or route) is handed to code whose checks are not followed |
| `route_not_matched` | a test request whose route is not a literal may be the one that covers this entry point |
| `unclassified` | an instrument no vocabulary, usage or declaration classifies |
| `check_not_proven` | a check was found and is not proven to run on every request, or only its name says what it is |

The JSON field is the snake_case name above (`reason`).

### Obligations: why a found check is not proven

When the reason is `check_not_proven`, the map also gives the obligation that failed, from a closed list:

| Obligation | What it says |
| --- | --- |
| `under_branch` | under a branch only some requests take, or in a loop |
| `after_conditional_return` | after a branch that returns without refusing |
| `and_operand` | an operand of `and`: it decides only when the other operands hold |
| `bypass_operand` | the right side of `or`: skipped when the left side holds |
| `not_awaited` | the call's result is not awaited |
| `swallowed` | its refusal may be caught by a handler that serves the request anyway |
| `by_name_only` | only the name of what is called says it is a check |
| `sides_not_caller_and_resource` | the two sides compared are not proven to be the caller's and the resource's |
| `after_effect` | a call that may change data runs before it, so it refuses after the effect |
| `not_called` | nothing read runs it for the unit |
| `callee_unread` | what it calls to decide was not read |
| `overridden` | a subclass overrides the method that holds it |
| `result_not_refused` | a policy decision is computed and nothing refuses on it |

The text names the check and the condition in the code's own words, for example `it is skipped when rule.visibility == "..."`.

## Declarations: `practices:` in `.drift/config.yaml`

A `practices:` block is a person's statement that an instrument Drift could not classify does what you say. Its shape is concern, then instrument key, then the label reports show:

```yaml
# .drift/config.yaml
practices:
  authz:
    "svc/services.py#RuleBook._ensure_access": "RuleBook._ensure_access"
```

Rules:

- The line is your statement that the check is what its name says and decides for every request that reaches it.
- It settles a route only where the route runs the named check on every path. A check the route reaches only sometimes stays `unknown` whatever is declared.
- A declared answer is counted as known and marked, for example, `known 100% (1 of them declared in .drift/config.yaml, not proven)`. It is a declaration, not a proof, and the output keeps the two apart.

Commit `.drift/config.yaml` so teammates and CI get the same declarations. Do not declare what you have not read.

## Hints

```bash
drift practices --hints
```

prints only the `.drift/config.yaml` lines that would classify what Drift cannot tell alone (an in-repo logger, a wrapper it cannot read, a check that was found and not proven), as one block to merge by hand, with the units each line settles:

```
# 1 unit(s) are unknown behind 1 name(s) Drift cannot classify alone.
# Each line says how a concern is done here; the value is the label reports show.
# Keep the lines that are right, merge them under one `practices:` key in
# .drift/config.yaml, and run `drift practices` again.
practices:
  authz:
    "svc/services.py#RuleBook._ensure_access": "RuleBook._ensure_access"  # 1 unit(s): check found, not proven (after_conditional_return)
```

If nothing would be classified, it says `Nothing to name: no unknown unit is behind something a practices: line in .drift/config.yaml would classify.` Review each line before you keep it: the hint lists candidates, and keeping one is your claim.

## Findings

The recipe is followed by findings, in rank order:

1. **`unscoped_key`:** a tenant or owner key that signed-in entry points take from the request and nothing checks or scopes. Said only where every body the request runs was read to the end, and never where authorization is unknown or a guard, permission or dependency class is around the entry point.
2. **`unexplained_split`:** two variants each hold at least 20% of a concern in a package and nothing sets the second apart.
3. **`none`:** authentication or validation recorded as none.
4. **`unknown`:** units that cannot be told because of one instrument, with the `practices:` line that would classify it.
5. **`duplicate_helper`:** the same top-level function in two or more production files whose copies call the same things, with every copy's path and line; at most five, listed last.

## Where else the map shows up

- **`drift card <file>`** has a "Practices here" section.
- **Agents** get the recipe once before they write a new entry-point file, and are told after an edit when a file's entry points do a concern another way than at least 80% of those around them. See [Using Drift with Agents](Using-Drift-with-Agents).
- **`drift check`** prints, under its own heading and after the exit code is decided, the concerns the checked files do differently from their neighbours, for the files it looked at (every file, the files named, or with `--diff-base` the files the diff added or changed). A route that does all its neighbours do and more is not one, a health probe is compared in no concern, and a one-off route is said with what it does itself. These never change the exit code: `practices.departures` in `--format json`, notices and a job-summary section in `--format github`, run notifications (not results) in `--format sarif`.
- **`drift init`** prints a line about what the map knows even when no conventions were proposed.

## Other readings that decide a state

- **Probes.** See "Authentication variants" above: a liveness or readiness `GET` that reads no request input is `opens probe`, not "no guard".
- **What is not asked about.** Unknown is kept for what may be the thing asked about and cannot be read. Reading the request (`request.json()` on a `NextRequest`, in a body that hands nothing to a call Drift did not record), building a value (`new X()`, Python's `CreateSessionRequestBody(...)`), and the standard library's `math.log` or an argparse parser's `error` are not that: a route that does nothing else reads `none`, and a symbol that only takes a logarithm is not asked how it logs. A webhook verifier called on an object built in place (`Webhook(secret).verify(...)`) is `service_auth`.
- **Error handling delegated to a function.** A route that builds no response and catches nothing itself, and returns the call of a function that does (`return proxyRequest(request, params)`), has that function's error handling: its catch that responds is the route's. A helper the route only awaits before returning something else is not followed.
- **Mounts and consumers.** A router mounted more than once is a unit for each mount in every concern whose unit is the entry point, with that mount's guards. Message consumers are listed apart (`consumers` in `--json`) and counted in no concern: a queue feeds them, so no caller signs in.
- **Tests.** A test covers a route when it asks for a path the route's template answers: `/things/7` is `/things/{thing_id}`, `/users/me` is the static route's and not `/users/{id}`'s, and `/v1/x` is not `/v2/x`. Where two routes fit equally, or the template holds syntax Drift does not read, the answer is unknown (`route_not_matched`).
- **A split authentication policy** (most routes behind one guard, one directory's behind another) is shown as one policy with its alternatives. It is decided package by package from that package's own entry points, so what another package does with either guard neither makes nor breaks it, and that package keeps its own policy.

## Authorization, specifically

Authorization is read where it lives. A call into a service class's method is followed through however the handler gets the instance: a parameter typed by the class or by a dependency alias (`XDep = Annotated[X, Depends(get_x)]`), an instance built in place, a `self` attribute, a module-level instance, or a base class that defines the method. A condition there that compares the tenant asked for, or a row's tenant or owner, and raises an error class named for a refusal is the route's check, named by the method (`tenancy_check:...#RuleBook.list_rules`). The dependencies around a route are read for what they check (`Depends(Authorize(...))` whose `__call__` answers 403 on the organisation in the route is its tenant guard). So are the decorators on a method the handler calls, a constructor where the class is built, a base's constructor reached through `super().__init__`, and a dataclass's `__post_init__`. Reading goes five calls down from the handler, over at most 48 bodies: what the deepest body read calls is unread, never taken for nothing. A method that a subclass in the repository overrides is not read from the annotated class.

For authentication and authorization, `known`, `none` and `unknown` mean this.

### `known`

`known` needs a check that was read where it is and is proven to run, and to decide, on every request to the route. A check records which way it compares: only a refused mismatch between something of the caller and something of the resource or the request is a tenant check, and a tenant or owner that is only asked for (`if not org_id: raise 403`) is no check. A name alone is never a check: not a dependency's, not a helper's, not that of a function whose answer a 403 follows (`ownsWorkspace`). A guard or permission class of the repository is known where its body is read to refuse; a library's own guard keeps the library's meaning.

### `none`

`none` means Drift found nothing that turns a caller away or scopes what is read in what it read, and lists beside the answer what it saw and did not read. Anything that could guard or scope the route and was not read makes it `unknown` instead, said with what to look at:

- a dependency list built where Drift does not read (`dependencies=COMMON`);
- a middleware or hook that answers 401 for some requests only;
- a decorator list that is not in the facts;
- an application or blueprint that goes where Drift does not read what is registered on it;
- a service reached through a registry or a lookup by name (`getattr(service, operation)(...)`);
- a method Drift cannot follow (a protocol, a dependency of unknown type);
- a refusal nothing read explains;
- SQL written as text, or a query builder's comparison that names a tenant or owner key;
- a request only handed to another service (`fetch`, an HTTP client).

A guard registered beside the route is read where Drift can read it and unknown where it cannot, never "no guard": a middleware given for a path that covers a mounted router, the hooks of a Fastify plugin and of the instance it is registered on, a helper that registers on the application it is handed, a guard handed to a router factory, options or handlers spread into the registration, a package's Fastify plugin, and a 401 sent from the `catch` of the token verification.

### Found, not proven

A check that was found and is not proven to run on every request leaves the route `unknown` (reason `check_not_proven`), and the map names the check and says why, never that the route does it:

```
unknown: a tenant check was found (`_ensure_access`) but is not proven to run on every request: it is skipped when rule.visibility == Visibility.SHARED
```

This is said of a check under a branch or in a loop, after a branch that returns without refusing, as one operand of `and`, on the right of `or`, inside a `try` whose handler goes on or a `suppress(...)`, in a helper that returns early, in a function nothing calls, in a callback handed to a timer or the event loop, behind a call that is not awaited, and after a call that has already changed data (``... but it runs after the route has already changed data (`db.commit`)``).

- **What counts as a change of data** is what the request asked the route to change: a guard's own bookkeeping before its refusal (a session refreshed, the caller's record mirrored) is not the route's effect. Whether a call changes data is read by following the repository's own functions three calls deep, and otherwise from the first word of its name; the line names the call that was taken as the write, so a wrong guess is visible.
- **Also found and not proven:** a check only its name says is one (a helper, or a guard or permission class of the repository whose body is not read to refuse), and a query filtered by a tenant or owner key whose value's source Drift does not know (every such TypeScript query today). In TypeScript it is also said of a check in a callback or a local function that only some requests reach, in a function kept in a table (`table[req.method]()`), in a sibling method called through `this` under a branch, and of a comparison where neither side is read off the caller (`params.orgId !== body.orgId`).
- A file's card repeats the line for its first such unit.

### A value of the caller

A handler that hands a value of the caller to a query or to code that uses it (`Shipment.objects.visible_to(request.user)`, `load(id, g.user.venue_id)`), compares one with a row's (`if s.depot_id != request.user.depot_id: continue`) or reads rows through the caller (`request.user.depot.shipments.all()`) is unknown for authorization, with the callee named, never `none`: the key need not be named for a tenant. A tenant filter's answer does not depend on the column's name: a key on no list (`org_id` or any other name) reads the same, and an unlisted key reads unknown, never `none`. None of this makes a unit `known`. A comparison with one before any refusal (`abort(404)`, a custom exception, a 400) is unknown too.

- **Python.** A value of the caller is read off a closed list of sources: a path named for a subject (`current_user`, `g.user`, `request.user`, `request.auth`, `session[...]`), what `g` or `request.state` keeps under a user-like name (`g.principal`, `request.state.claims`), `request.scope["user"]`, a claims accessor called with nothing (`get_jwt()["venue_id"]`, `get_jwt_identity()`), what a dependency that signs the caller in gives, a local assigned from any of these, what a function of the repository called with nothing or with the request hands back where its body returns one (`def current_venue_id(): return get_jwt()["venue_id"]`), and what a hook or middleware of the repository binds on `g` or `request.state` under any name. What a dependency gives counts only where the dependency signs the caller in: a comparison with a value of `Depends(get_db)` scopes nothing. DRF permission classes that are not a list written in place (`BASE + (X,)`, `A | B`, `get_permissions`, an action's own) are unknown.
- **TypeScript and JavaScript.** A handler that hands a value of the caller to a query, a helper or a service (`eq(parcels.depotId, session.user.depotId)`, `listFor(req.user.depotId)`), compares one, switches or indexes by one, or puts one in a template given to a call is unknown for authorization with the use named, never `none`, whatever the column is called. The value is read off a closed list of sources (a sign-in accessor such as `auth()` or `getServerSession()`, `req.user`, `res.locals.user`, `c.get("user")`, `ctx.session`, a parameter decorated `@CurrentUser()`, a key a middleware of the repository binds on the request, what a function called with the request hands back) and followed through locals, callbacks, `then` and helpers that hand it back. Logging it, returning it, a rate-limit key and a presence test are no scope.
- **What keeps a route from `none`.** In TypeScript, a value of the caller carried by `nestjs-cls`, `AsyncLocalStorage`, a request-scoped provider, a module-level holder or a query object, an ORM-level filter, and a NestJS interceptor all keep authorization from `none`. A policy decision that nothing refuses on is found, not proven. In Python, what a repository configures outside the route is read as unknown, never as nothing: a FastAPI route class (`APIRouter(route_class=...)`), the `decorators` of a Flask-RESTX namespace or API and of a Flask-RESTful API, router options unpacked from a value, a decorator that hands the view back unchanged on some path, a Django `MIDDLEWARE` entry of a package Drift does not know, and a dependency replaced by `app.dependency_overrides` outside the tests. `method_decorator(..., name=...)` applies to the method it names only. A value of the caller kept outside the handler (a `ContextVar`, a thread-local, a module-level holder), a Django manager that overrides `get_queryset`, a database session variable set for row-level security, and a filter through a query API Drift does not read (Peewee) keep a route from `none`; a role compared from what the request sent (a header, a body field, a query parameter) is found, not proven.

### Sign-in guards in TypeScript and JavaScript

- **A guard whose only 401 is sent from a `catch`.** It is read by the shape of the function, in Fastify, Express, Hono, NestJS and Next.js: the `try` verifies before anything in it serves, the handler answers 401 and hands the request on nowhere, and the function goes on only past the `try`. A handler that swallows is no guard. A 401 under a further condition, a `try` under a branch, and a handler after which the request is handed on are found and not proven (unknown). A function of an object or a static method used as a guard is read for itself. `drift security` says of each such route what the practice map says.
- **A helper that returns its 401** (`NextResponse.json(..., { status: 401 })`, `c.json(..., 401)`, `{ error: <response> }`) guards a handler only where the handler returns what it was handed (`const denied = await requireSession(req); if (denied) return denied;`). Called as a statement of its own it guards nothing; used in any other way, unknown. A middleware that answers 401 in a branch and then still calls `next()` is found, not proven. A sign-in check that only some requests reach (after a return that serves, under a branch) is not proven, and neither is a Next.js middleware whose refusals all stand after such a return.
- **One rule for what stands where a guard goes** (a middleware argument, a hook, a wrapper, a decorator, a tRPC procedure step): a function of the repository that turns every request away is a guard, one read to turn no one away is nothing, and everything else is unknown. A library's guard is known only in a call shape on a closed list (`crates/drift-core/src/guard_lists.rs`: passport, express-jwt, Hono's `jwt` / `bearerAuth` / `basicAuth`, `@nestjs/passport`, `@fastify/auth` and others, each with the options understood); a package on neither that list nor the list of what never authenticates, a value with no name, and a composition that is not read are unknown, never "no guard". A token verification called uncaught where a guard goes is unknown, not nothing. The practice map and `drift security` give the same answer for every TypeScript route.
- **NestJS.** The middleware a module applies in `configure` is the guard of the routes `forRoutes` covers and `exclude` does not, where it is written as literals; a variable, a pattern, a condition, or a path under a global prefix leaves those routes unknown. A guard registered with `app.useGlobalGuards(new Guard())` is read as an `APP_GUARD` provider is, wherever the call runs for every start of the application; under a condition, or given anything but a class built in place, the routes are unknown. An `APP_GUARD` provided by a factory or a condition is not read. `@Public()` (any `SetMetadata` decorator) opens a route only where the guard's `canActivate` is read to return true for the key it sets (`if (this.reflector.getAllAndOverride(KEY, [...])) return true;`); under a guard that is not read to honour it, such a route is unknown.
- **A response built as a value.** A response built and dropped (`NextResponse.json(...)` written as a statement of its own) refuses no one: a refusal counts only where it is returned. A function that only builds a response checks no one.
- **Providers and configuration Drift cannot follow.** A Nest `@Module` provider that is no object written in place is read for what it is bound to, and a binding of any name, a call, a member or a spread is not read. Where ORM configuration (filters, plugins and subscribers registered on queries), a Nest provider or a Next.js configuration handed to a wrapper Drift does not know is something Drift cannot follow, the routes it may reach read unknown, never `none`.
- **Fastify, Express, Hono, Next.js.** A listener written in front of an application (`http.createServer((req, res) => { ...; app(req, res) })`) is read as a middleware of that application, also when it is given by name, declared in the same file or imported. Fastify route options are read in order (the last writer of a hook wins; an unreadable spread after the hook is unknown). Fastify plugins exported with `module.exports` or `export default async function (app)`, routes a function registers under a condition, and routes registered in a loop or a `switch` are listed. A Next.js route the middleware guards is unknown where a rewrite in `next.config` reaches it from a path the matcher does not cover, and a Next.js configuration handed to a wrapper Drift does not know may add rewrites: the routes its middleware covers are then unknown. Routes under a Fastify plugin's `prefix`, a Hono `basePath`, or several paths (`app.use(["/a", "/b"], router)`, `@Controller(["a", "b"])`) are listed once per path.

### Sign-in guards in Python

What stands where a guard goes (a decorator, a FastAPI dependency, a Flask hook, a permission class, a base, a middleware) is read by one rule: a function of the repository by its body, a library by closed lists of the call shapes Drift understands (`crates/drift-mine/src/py_guards.rs`), and anything else as unknown. A library guard with an option that makes it optional (`jwt_required(optional=True)`, `HTTPBearer(auto_error=False)`) is not a guard; a package Drift has no list for is never read as no guard; a dependency that returns a 401 response instead of raising it refuses no one; a decorator written above the route decorator guards nothing; and a guard is read from its body, never from its name. The cases the inventory shares with this map (app-wide hooks, Starlette middleware, DRF and Django classes) are under "Guards, case by case" on [Security Inventory](Security-Inventory).

A route bound to a Python class (a Django or DRF class-based view, a Flask view class) is read through the method that runs, found in the order Python looks methods up in (C3), together with what the framework runs for every request before the handler (`setup` and `dispatch`; DRF's `initial` and `check_permissions`; Flask's `dispatch_request`). Where the order cannot be worked out (inconsistent bases, too deep), only the class's own methods are read and the unit is unknown. A package's class that may define the method before the one that has the check makes the check one some requests run: found, not proven. A base of the repository that comes after a class whose `dispatch` never hands on is no role guard.

### Settling it

`drift practices --hints` (above) lists first the checks one `practices:` line settles, each with the units it frees and why it is not proven. A check the route reaches only sometimes stays unknown whatever is declared.

On a 3,200-file monorepo, authorization reads 19 known, 2 none and 116 unknown of 137 units, and 64 of the unknown carry a check that was found; authentication reads 150 known, 20 none and 8 unknown of 178 units. An earlier build read 74 of the authorization units known; that figure included answers that were not proven, and an independent review found about 14 of 31 sampled to be false. The 19 are what is proven, each read against the source: a count of proofs, not of how much of the repository checks authorization. This is why most routes read `unknown` for authorization. The caller's side of a comparison is partly taken from names today (`req.user.orgId`, a parameter called `session`), and a TypeScript query filtered by the session's own value is `unknown`. See [Accuracy and Limits](Accuracy-and-Limits).

See also: [How Drift Works](How-Drift-Works), [Security Inventory](Security-Inventory), [Setup Questions](Setup-Questions), [Using Drift with Agents](Using-Drift-with-Agents), [Output and JSON Reference](Output-and-JSON-Reference), [Glossary](Glossary).
