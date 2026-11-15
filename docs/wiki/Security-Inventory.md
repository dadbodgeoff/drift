# Security Inventory

This page explains `drift security`: the inventory of entry points with their guards, the risky operations they reach, client code that reaches server-only code or secrets, environment reads, and where each entry point can be reached from (exposure). It covers how guards and exposure are decided, which deployment descriptions Drift reads and which it only recognises, and the three settings that tell it more: `security.not_deployed`, `security.terraform` and `security.internal`. It is for security reviewers, platform engineers and anyone who reads an exposure line.

The inventory states facts for a person to review. It is not a rule set and never fails a check. Drift is a guardrail, not a security control, and every report ends with what it does not cover.

## Running it

```bash
drift security
```

```bash
drift security app/api/export/route.ts
```

```bash
drift security --json
```

Files named on the command line limit the text output to rows for those files (the `--json` output is always the full inventory). `--max N` sets the rows shown per section in text output (default 20; entry points with no wrapper or decorator always show the first 50). On the example fixture:

```
43 entry points (5 where Drift found no guard in what it read, 1 reaching a risky operation), 1 risky operations, 0 client file(s) reaching server-only code or secrets, 0 env vars read

Risky operations
  sql_string_interpolation (1)
    app/api/search/route.ts:2 GET

Entry points reaching risky operations
  app/api/search/route.ts:2 GET [http] GET /api/search | no guard found in what Drift read
      sql_string_interpolation

Entry points where Drift found no guard
  http GET /api/health  app/api/health/route.ts:1
  http GET /api/new  app/api/new/route.ts:1
  http GET /api/r38  app/api/r38/route.ts:1
  http GET /api/r39  app/api/r39/route.ts:1
  http GET /api/search  app/api/search/route.ts:2

Not covered: checks inside handler bodies other than sign-in checks (a 401, a sign-in redirect, a call of a proven guard), whether the caller may act on the record it asks for, rate limits, and anything applied outside this repository (gateways, proxies, platform settings). A shared guard is what this repository does, not a verdict on its exceptions.
```

## What it lists

- **Entry points:** HTTP routes, jobs, queue consumers, commands, with their guards and wrappers. A router, blueprint or URLconf mounted more than once is one entry point per mount, each with that mount's guards and exposure. A route table registered in a loop is listed under an unknown prefix (`?`), so a route that is served is in the inventory though its path is not known; behind a gateway it is unknown, never internal.
- **Command-line programs and message consumers** are run by whoever already has a shell, or fed by a queue with no caller to sign in. A command-line program (`cli`: argparse, click, typer, a console script, an npm `bin`) stays in the inventory (`local` in `--json`) but is not counted or listed as having no guard, and the first line says how many were left out. A message consumer (`consumer`: a class that consumes from a queue) is listed and counted apart the same way (`7 consumer not counted: fed by a queue, no caller to sign in`).
- **A route file that only re-exports its handler** (`export { GET } from "../v1/x/route"`) is an entry point of its own, listed under its own path with the guards and reaches of the code it re-exports.
- **Entry points where Drift found no guard** are listed by file and line (the first 50, then a count), each with the count of what Drift saw there and did not read (`2 not read`). "No guard" means no guard found in what Drift read, never that the route is open: see "What `none` and `internal` rest on" in [How Drift Works](How-Drift-Works). `--json` has every entry point with its `guards`, `wrappers` and `package`.
- **Risky operations**, detected syntactically and narrowly: `eval`, shell commands, raw HTML, raw SQL and SQL built by interpolation, redirects and requests to computed URLs (literal or configured origins do not count), MD5 and SHA-1, `jwt.decode`, cookies without `httpOnly` and CORS for any origin. Request-driven ones are followed through up to four internal calls from each entry point.
- **Risky operations read since the last measured build** (shown here and in the practice map; mining does not read them yet): SQL built from a value and bound to a name before the query is given it (`q = f"SELECT ... {name}"; cursor.execute(q)`), built by a chain of `+`, or added to with `+=`; a file at a path built from a value (`path_traversal`: `fs.readFile(path.join(dir, name))`, `open(os.path.join(UPLOADS, name))`); template text that is not written out (`template_injection`: `render_template_string(body)`, `ejs.render(body)`); a MongoDB `$where` built from a value (`nosql_injection`); an XML parser set to resolve external entities (`xml_external_entities`, Python); a signing secret written in the code where a token is signed or a session keyed (`hardcoded_secret`: `jwt.sign(payload, "...")`, `app.secret_key = "..."`); a server started in debug mode (`debug_enabled`, Python); TLS without certificate verification (`tls_verify_disabled`: `verify=False`, `rejectUnauthorized: false`); a row written from the whole request body (`mass_assignment`: `User.create(req.body)`, `User(**request.json)`); a regular expression built from a value (`dynamic_regex`: `new RegExp(pattern)`); requests to computed URLs through needle, superagent, ky and ofetch; and Angular's `bypassSecurityTrust*` (as `raw_html`). In TypeScript, SQL that interpolates only constants, numbers, configuration or a list of placeholders is no longer listed as interpolation. These are still syntactic: a hit says where to look, not that input reaches it.
- **Fed by a parameter.** An operation is marked `(fed by a parameter)` (`fed` in `--json`, on a risky operation and on what an entry point reaches) where the value it is given is read off a parameter of the function it is written in, and, some calls away from the entry point, where each call on the way handed on a value read off a parameter. For a handler a parameter is what the request sent, so this is what says that input may reach the operation. It is read from the code, not from names: a member or an item of the parameter, a local bound to one, text built from one, in the order written; in Python also what the framework's request object holds. A function that makes the handler (`app.post("/login", login())`) is read by the parameters of what it makes. An operation given a constant or a setting is not fed, and a helper's own parameter does not count unless the caller passed it a value read off its own. Not followed: values through object fields set elsewhere, class members (TypeScript), and callbacks.
- **Places that look served and are not listed.** Two kinds, counted on the second line and named by file and line (`unlisted` in `--json`): a call written as a route is (`x.get("/path", (req, res) => ...)`) that no listing accounts for, and a function that reads what a request sent and answers it (a response built in its own body) that no listed entry point reaches through any number of calls, wrappers or middleware (`symbol` names it). The second is said by what the function does, whatever framework serves it, so it also covers frameworks Drift has no adapter for.
- **What most entry points scope to the caller, and the ones that do not.** Where at least 70% of the entry points that query one thing (what the query is called on: `prisma.note`, `Item.objects`), five or more of them, give the query a value of the caller under one key (`where.userId`), the ones that query it and give it no value of the caller are listed with one to copy (`scope_gaps` in `--json`). Nothing names the key or the thing: both are whatever the repository's own queries do. The exceptions are facts to look at (an administrator's route and a lookup that a check follows are among them), not verdicts.
- **Order.** Entry points reaching a risky operation are listed by what most needs a look first: no guard found, then a guard that cannot be read, then guarded; within that, internet-facing before unknown before internal, and operations fed by what a request sent first. The order ranks facts and judges none; `--json` keeps its own order.
- **Client leaks:** client code (`"use client"` files) that reaches server-only code or secrets (`server-only`, Node `fs`/`child_process`, database drivers, `PrismaClient`, `stripe`), and environment variables with no public prefix read by client code. Leaks follow value imports from `"use client"` files to server roots, honour TypeScript import elision, follow a barrel's re-exports only for the names imported through it, and are grouped by the module to cut at.
- **Environment reads:** each variable and the files that read it.
- **Skipped files:** source files Drift did not read (too large, minified, nested too deep, not UTF-8) are named under the first line, since an entry point or risky operation in one is not listed (`skipped` in `--json`).
- **Test and demonstration code** is left out, with a count of how many files and where (`left_out` in `--json`): tests, stories and fixtures, and demonstration code (a package inside an `example(s)`, `sample(s)`, `demo(s)` or `playground(s)` directory, or such a directory at the top of the repository or of a package). A folder with one of those names deeper inside an app (`app/examples/page.tsx`) is production. A top-level `integration/` directory is test code when most of its tests are standalone.

## Guards

A *guard* is a call wrapper or decorator whose definition turns callers away (rejects an unauthenticated or unauthorised caller), a library's own guard that Drift knows, or one applied by settings or an app-wide hook. Other wrappers (a FastAPI `Depends(get_db)`, an error mapper) are listed as wrappers, never as guards. A check in the handler's body counts the same way: a call that turns the caller away (`requireSession (body call)`), or an in-body 401 or sign-in redirect (`(body check)`).

A TypeScript function is also a guard where it throws for every request with no caller, whatever it throws and wherever a redirect sends them: an `if` every request reaches, taken exactly where a value that says who calls is absent, whose branch always ends in a `throw` (`const userId = await getUserId(request); if (!userId) throw redirect(target)`). The value says who calls where it is the caller's by its own source, where it is what a call or a lookup in the same body made of a credential the request carries (its `Cookie` or `Authorization` header, or the cookies a framework parsed), or where it is what a function given the request handed back and that function's every return gives such a value (`returns_credential`) or a value of the caller. A function that returns before the test (`if (!cookie) return null`) lets requests through that passed none, and a helper that throws where a row the URL names is absent turns away no caller: neither is a guard. No name is asked: not the function's, not the redirect's target.

A guard is read from its body, never from its name. A helper that only looks like a guard (routes share it, it throws, its name is about access, and nothing shows that what it throws turns an unauthenticated caller away, such as `assertSession()` throwing a plain `Error`) is neither: its entry point is listed under "Entry points whose guard cannot be read" with the call as `opaque` in `--json`, and counted neither as guarded nor as having no guard. A guard where only some requests are turned away, where the guard's 401 depends on a branch on the credential's presence, or where an optional flag makes it optional (`jwt_required(optional=True)`, `HTTPBearer(auto_error=False)`) is not a guard. A guard written where Drift does not read (a dependency list built elsewhere, a package's middleware no list knows) leaves the route `opaque`.

### Guards, case by case

The practice map reads the same routes by the same rules, so the answers agree (see [Practices Map](Practices-Map)).

- **Next.js pages under a guarded layout.** A page with no guard of its own under a `layout.tsx` that turns away whoever is not signed in reads *guard unknown* with the reason `layout_may_redirect` and the layout's file and line, never "no guard found" and never a guard: a layout and its page render in parallel and a layout is not re-run on client navigation, so a layout check is not proven to stop the page's own server work. Check in the page or its data layer. Route handlers (`route.ts`) and server actions under such a layout are unchanged.
- **Webhooks that verify a signature** are listed in their own section, *Entry points that verify a webhook signature (no sign-in by design)*, with a row such as `verifies a signature (svix Webhook.verify); no sign-in by design`: svix and standard-webhooks `Webhook.verify`, Stripe `construct_event` / `webhooks.constructEvent` and Slack `SignatureVerifier.is_valid_request`, each only when it runs for every request and a failed verification leaves the handler (thrown uncaught, or answered with a 4xx). A verification that is swallowed, only logged, made for some requests only, or whose result is ignored reads *guard unknown* (`signature_not_proven`). The practice map reads them by the same rule.

- **A helper that looks like a guard but is not read to be one** is listed under "Entry points whose guard cannot be read". `drift practices` reads the same route as unknown and offers the `practices:` line that names the helper (`drift practices --hints`).
- **App-wide hooks.** A hook the application runs is a guard of the routes it runs for, and of no other. One registered under a branch, in a loop or in a `try` is on only some of the applications built, and is no guard. One that turns callers away for some requests only (`if request.path.startswith("/admin")`) is `opaque`: which routes those are is not read. A hook the whole application runs is a guard only where it turns callers away (answers 401 or redirects to sign-in); one that opens a database session or loads the user is listed among the wrappers (`load_user (app hook)`).
- **Applications and blueprints that go where Drift does not read.** An application or blueprint passed to a package's function, built by a class of the repository with its own constructor, or with its hook registries written directly may have a guard that was not seen. Its routes are `opaque`, never listed as having no guard (`opaque: 'admin' passed to 'protect', which Drift does not read (shop/app.py:9)`), and `drift practices` reads their authentication as unknown.
- **Middleware** is read as the practice map reads it: the guard, listed `SignIn (middleware)`, where it answers "not signed in" for every request, and `opaque` where it may (some requests only, or a package's that no list knows). A guard whose only 401 is in the `except` handler of the token's verification is a guard where every request reaches that `try` and every handler refuses; where that is not proven it is `opaque`. A dependency or decorator that could not be read (`Depends(GUARDS["user"])`) is `opaque`, never "no guard". An application served through what wraps it (`uvicorn.run(require_signature(app))`, `app = TokenMiddleware(app)`) is read through the wrapper.
- **Starlette route tables.** Middleware given on the way to a route (`Mount("/api", routes=[...], middleware=[Middleware(ApiKey)])`, the router or application a mount serves, `Route(..., middleware=[...])`) is read as the application's own: the guard where it answers 401 for every request, `opaque` where the list or a class in it is not read (a name, a concatenation, a package's class no list knows). A route beside the mount is not behind it. A `Mount` in a table that is not read (built in a function) leaves its routes `opaque`.
- **DRF and Django.** DRF's `IsAuthenticatedOrReadOnly` and `DjangoModelPermissionsOrAnonReadOnly` guard writes only: a `GET` behind one has no guard, and an entry point listed for every method is `opaque`. A DRF permission class of the repository is read from its own `has_permission`: a guard where that is false for a caller who is not signed in, no guard where it is `True`, `opaque` otherwise. Django's `user_passes_test` and `UserPassesTestMixin` are read by their test. A Django mixin guards only where it comes before the view class in the bases (`class V(ListView, LoginRequiredMixin)` has no guard).
- **Proven only where every request is refused.** A dependency, decorator or middleware that returns for a caller with no credential before its 401 (`if not authorization: return None`), answers 401 only under a branch on the credential's presence, or calls its guard for some requests only, is `opaque`.
- **One answer for a Python route**, here and in `drift practices`: a view guarded by a base class is listed with `(base)`, a handler that calls what is not in the facts is `opaque`, and a wrapper that could not be read beside a proven guard leaves the guard counted only where it cannot answer first (a FastAPI dependency, a decorator inside the guard).

### Shared guards and their exceptions

When at least 90% of the entry points of one kind in one place share a guard (a population of at least 8), the ones without it are listed with a member to copy:

```
Guards most entry points of a kind share, and the exceptions
  withWorkspace: 42 of 45 http entry points in app/api/ have it; 3 do not
      http POST /api/webhooks/stripe  app/api/webhooks/stripe/route.ts:3  no guard found in what Drift read
      to copy: app/api/links/route.ts:5 GET
```

The population needs 8 members, and a gap is reported at the broadest place where the guard reaches 90%. A narrower directory adds a row only for a guard of its own (`withAdmin` under `app/api/admin/`). The line under `to copy:` is the source line of that member. The exceptions are often meant (webhooks, health checks, public pages): they are listed, not judged. `--json` has them under `guard_gaps`.

When a project has conventions, each shared guard names the one that says the same: `convention [a1b2c3d4] accepted, advises` is what `drift check` already reports, and `proposed as [a1b2c3d4]: drift review --accept a1b2c3d4 makes it a rule` is the one command between an observed guard and a rule that blocks.

## Exposure: where an entry point can be reached from

Each entry point has an exposure, named next to it with the reason, never used to hide it:

| Exposure | JSON value | Meaning |
| --- | --- | --- |
| internet-facing | `public` | something in the repository provably carries requests to it |
| internal | `internal` | nothing found in what Drift read gives a way in: worded "internal in what Drift read", with what was read and what was not |
| unknown | `unknown` | something it met was not read, or nothing in the repository says |

**`internal` is said only where Drift read everything that could give a way in and found none, and it says so as a finding, not a fact.** Anything Drift meets and does not understand makes the route unknown, and the reason names it as written. Internet-facing entry points are listed first, then unknown, then internal. A first line such as `Exposure: 2 internet-facing, 0 internal in what Drift read, 0 unknown (from compose files)` summarises the counts and their sources (`Exposure: 60 internet-facing, 104 internal in what Drift read, 32 unknown (from .drift/config.yaml and compose files)` where the config says some outright), and each row names its reason:

```
Entry points where Drift found no guard
  http POST /api/webhooks/stripe  app/api/webhooks/stripe/route.ts:3  internet-facing (compose service web in compose.yaml publishes ports)
  http GET /internal/health  platform/apps/ledger-svc/api/health.py:12  internal in what Drift read (config security.internal)  1 not read
```

The trailing `1 not read` counts what Drift saw and did not read for that row: files the scan skipped, deployment descriptions it recognises and does not read, and the like. In `--json` it is the row's `exposure_basis` (`bodies`, `descriptions`, `not_read[{kind, what, why}]`); the same list is the reason a deployment description Drift does not read keeps a route from being `internal`.

### What Drift reads

- **Compose files** (any YAML file with a `services` mapping, whatever its name, to six directory levels, outside hidden directories, `node_modules` and what `.gitignore` leaves out), read as compose reads them (`include`, `extends`, override files, a `docker-compose.prod.yml` beside the base). A service that publishes `ports` is internet-facing; one that does not is internal only on proof. The service is tied to code by the directory its `build` points at.
- **Several stacks for one service:** the most exposed decides. A test stack that publishes the service's ports, or whose gateway routes to it, makes its routes internet-facing. Where more than one stack has the service behind a gateway, a route's reason names each stack with what it says (`internet-facing in e2e/stack.yml (...); internal in docker-compose.yml (...)`; `descriptions` in `--json`).
- **Reverse proxies and gateways** configured in the repository: nginx (a `.conf` or `.template` mounted under `/etc/nginx` or copied there by its Dockerfile; `server` and `location` blocks, `proxy_pass`, `rewrite ... break`), Traefik (routers on compose labels) and Caddy (a mounted Caddyfile). A route is internet-facing when a rule provably carries it, internal when none can and everything was read, unknown otherwise, with the reason. Traefik's file provider, HAProxy and Envoy configuration are not read.
- **Clients and relays:** an application that names a service and only calls it is a client of it, but only where the path of every request it sends there is written out. The HTTP clients read are `fetch`, axios, got, ky, undici, node-fetch, ofetch, superagent, needle, Node's `http`/`https`, httpx, requests, aiohttp and urllib3; a client from another library or one a factory builds (`axios.create`) is not seen.
- **`.drift/config.yaml`**, which says it outright and wins (below).

### Compose: how a service is tied to code, and when it stays internal

- **Tying a service to code.** A service is tied to the directory its `build` points at, relative to the compose file (which the source names). A service built from the repository root with a `dockerfile:` is located by the Dockerfile's directory. A service whose directory is the root, or any other directory above the compose file's own, applies to nothing, with a warning, since that directory holds its neighbours' code too.
- **Services built from one directory** are internet-facing when any of them publishes ports, as a web service and its queue consumer built from one Dockerfile are.
- **Something else may let requests in.** Within a compose file, a service is not internal while something else may let requests in: another service that runs an image and is not a data store Drift knows (a proxy such as `kong:3`, a tunnel that publishes nothing: `compose service tunnel in docker-compose.yml may let requests in to api (image cloudflare/cloudflared:2024.8.2): what it routes is not read`), a network marked `external`, or an application of the repository that can proxy and names the service.
- **A client is not a way in.** An application that names the service and only calls it is a client, and the reason says so (`called by web as a client`). It is a client only when the path of every request it sends there is written out: a handler that builds the URL from the request it serves, a URL Drift cannot read, or a framework rewrite whose target is not a literal makes the service's routes unknown, with the handler or setting named.

### Behind a gateway, exposure is each route's

When a compose service runs nginx (the stock image, or a Dockerfile that starts `FROM nginx`), publishes ports, and its configuration is in the repository (a `.conf` or `.template` file mounted under `/etc/nginx`, or copied there by its Dockerfile), Drift reads what it routes:

- `server` and `location` blocks (prefix, `^~` and `=`; an exact match wins, else the longest prefix, as in nginx);
- the service `proxy_pass` names (its compose name, `container_name`, an alias, or through an `upstream` block);
- what changes the path the service sees (the URI part of `proxy_pass`, `rewrite ... break`).

A route of a service that publishes no ports of its own is then:

- **internet-facing** when a location delivers its path to the service: `gateway gateway (platform/apps/nginx.conf) routes /v1/rules to ledger-svc`;
- **internal** when the gateway is the only way in, all of its configuration was read, nothing it sends the service can be that route, and what serves the route was read to the end: the start command (the server, its options, the scripts it runs, each variable) and an application object with no option, middleware or wrapper that Drift does not know to leave paths alone: `gateway gateway (platform/apps/nginx.conf) routes no location to /internal/v1/jobs/lease on ledger-svc: reachable only inside the compose network`;
- **unknown** otherwise, naming what was not read: a regular-expression location, a variable or an address in `proxy_pass`, an `include` (other than `mime.types` and `conf.d/*.conf`), an `if`, a `rewrite` without `break`, a fallback to a named location, any directive Drift does not know, an image, `command` or Dockerfile step that may add configuration, a location to the service that matches none of its routes (they may be mounted under a prefix Drift does not see), a `root_path` given to the app, a `network_mode`, a start command or an application object with something Drift does not know (`its start command has '-k app.worker.ApiWorker', a worker class Drift does not know`), a route under an unknown prefix (`?`, below), or a route of a framework whose mounts are not all read (Express, Hono, Fastify, NestJS: a router mounted in a callback or under a variable prefix keeps its own path, and NestJS module and global prefixes are not read). Such a route is never called internal behind a gateway that routes to its service.

Internal is never a guess: in doubt the answer is unknown, and the line says why. A service that publishes its own ports stays internet-facing for every route, and a `security:` setting for its directory still wins. Entry points that are not routes (a job, a command) take the service's answer as a whole.

Traefik (the routers on compose labels: `Host`, `PathPrefix`, `Path`, a `stripprefix` middleware) and Caddy (a Caddyfile mounted from the repository: `reverse_proxy` with a path matcher, `handle`, `handle_path`) are read rule by rule with the same strictness: `gateway traefik (docker-compose.yml) routes PathPrefix('/v1') to api`. A route is internet-facing when a rule provably carries it, internal when none can and everything was read, unknown otherwise, with the reason. A configuration nested more than 32 levels deep is refused, not walked, and comparing routes with locations takes bounded work: past the budget the answer is unknown. A regular-expression location is not evaluated, so a route a prefix location carries is internet-facing even where a regular expression would answer it first. "Internal" means the compose network, as far as the repository describes it: what is deployed from outside the repository, and CI scripts, are not seen.

### Routers mounted more than once, and route tables

A router, blueprint or URLconf mounted more than once (`app.include_router(rules, prefix="/v1")` and again with `"/v2"`) is one entry point per mount, each with its own exposure and the guards of its own mount: the router-level and mount-level dependencies in Python, the middleware of each mount in Express and Hono. With `include_router(rules, prefix="/admin", dependencies=[Depends(require_admin)])` and `include_router(rules, prefix="/public")`, `GET /admin/rules` is guarded by `require_admin` and `GET /public/rules` is listed with no guard. A mount whose dependencies cannot be read is unknown for its own routes (`opaque` in `--json`: `what its mount adds`), never given another mount's. A Python handler routed more than once (route decorators on two blueprints or two applications, a view registered on both with `add_url_rule`) likewise carries each route's own hooks and guards, and two routes at one path that differ are `opaque`.

A Python router that nothing Drift reads mounts, or whose prefix is not a string literal, is served under an unknown prefix, written `?` (`/?/jobs/lease`). A Python route table registered in a loop or from a data structure names no view where the call is written:

```python
for rule, view, methods in ROUTES:
    app.add_url_rule(rule, view_func=view, methods=methods)
```

Every view such a call may be handed is listed under the unknown prefix (`http ANY /?  shop/views.py:4`; `/v1/?` on a blueprint or router with that prefix), so a route that is served is in the inventory though its path is not known; behind a gateway it is unknown, never internal. The same holds of FastAPI's `add_api_route` in a loop, a comprehension, `getattr(views, name)` and a route decorator called as a function there (`app.route(rule)(view)`). A table handed to a helper in another file (`register(app, ROUTES)`) lists nothing.

### What Drift recognises and does not read

Where a deployment description of one of these kinds is in the repository and Drift does not read it, nothing it may route to is called internal. The reason keeps the compose finding and names the files (`boundaries.unread` in `--json`):

- Kubernetes manifests (YAML or JSON), Helm charts, Terraform, CloudFormation and SAM (YAML or JSON), ARM and Bicep templates, Azure Container Apps, an API gateway's OpenAPI document (`x-amazon-apigateway-integration`, `x-google-backend`), CDK, CDK for Terraform, Pulumi and SST apps (by their files or by the dependencies a `package.json`, `requirements*.txt` or `pyproject.toml` names), ECS task definitions, AWS Copilot, Kamal, Cloudflare Workers, App Engine's `dispatch.yaml`, Cloud Build files that deploy, Nomad and kustomizations, anywhere in the repository.
- Fly.io, Render, Vercel, Netlify, Firebase, App Runner, Railway, Elastic Beanstalk, Serverless, App Engine or a Procfile, for the code of their directory, unless they route elsewhere (a rewrite to another host, a Render Blueprint `rootDir`, a `fly.toml` that builds another directory), which then count as infrastructure.

```
http POST /internal/jobs/lease  api/app/jobs.py:6  unknown (compose service api in docker-compose.yml publishes no ports; but Terraform (infra/main.tf) in the repository is not read and may route to it; security.terraform in .drift/config.yaml can tie this code to the target group that forwards to it)
```

An env file outside the repository (a gitignored `.env`) does not by itself make a route unknown, and never silently: one warning names the file, and every internal verdict reached past it ends `not read: env file api/.env (not in the repository)`. An env file that is in the repository and cannot be read makes the route unknown.

### `security.not_deployed`: descriptions that deploy nothing

Tell Drift that a compose file (an end-to-end test stack, for instance) deploys nothing with a list of files or directories:

```yaml
# .drift/config.yaml
security:
  not_deployed: [e2e/stack.yml]
```

What is left out is said once in the warnings, and a route a left-out file would have exposed says so. Do not list a real deployment: that would be a false statement. `drift setup` can ask this for you; see [Setup Questions](Setup-Questions). On the example fixture with an end-to-end stack that publishes ports, listing it moves both routes from `2 internet-facing` to `2 internal` in the compose reading, and `e2e/stack.yml: left out by .drift/config.yaml (security.not_deployed)` appears in the output.

### `security.terraform`: tie code to its target group

Drift does not read Terraform on its own. Terraform that does deploy a service is not left out; tie the code to the target group that forwards to it:

```yaml
# .drift/config.yaml
security:
  terraform:
    - target: infra/modules/api   # or infra/modules/api#aws_lb_target_group.api
      code: services/api
```

This is your statement that the target group forwards to that code, and that requests from outside reach it, in what this Terraform deploys, only through load-balancer rules that forward to that target. Drift then reads every `aws_lb_listener_rule` in the repository's Terraform for the routes of that code: internet-facing where a rule carries the route to the tied target, internal where none can, unknown where a rule is not in the plain form Drift reads (`count`, `for_each`, `dynamic`, a variable pattern or target, another kind of condition), where a listener or a load-balancer module forwards by default, or where a `terragrunt.hcl` has a `generate` block. A tie can therefore move no route: with a listener rule that uses `count`, the routes stay `unknown`, and `drift setup` still answered "no route moves" when you confirmed it. The route's reason in `drift security` says which rule and why, in this form: `listener rule 'api' (infra/api/main.tf:9), which forwards to infra/api#aws_lb_target_group.api, is not read (it has 'count') (tied to the repository by .drift/config.yaml)`. Each such verdict names `.drift/config.yaml` and is counted apart (`tied` in `--json`, a second line under `Exposure:`). What else Terraform opens to the code is not read, and Drift does not check whether an application another rule publishes relays requests to the tied service. Kubernetes and the other descriptions have no tie. Where Drift sees a target group that plainly looks like the one that serves a service, `drift setup` asks you whether it is right.

### `security.internal` and `security.public`: say it outright

```yaml
# .drift/config.yaml
security:
  internal: [platform/apps/ledger-svc, platform/libs]   # behind the gateway
  public: [frontend]
```

A directory listed here is called internal (or internet-facing) for the whole directory, on a person's word, and the setting wins over every reading. The reason says `config security.internal` or `config security.public`. It is the only way to call a directory internal when its deployment is described by Kubernetes or another description with no tie. Use it for what you know and the repository does not say.

### A worked example on a monorepo

This is a measurement recorded on a private 3,200-file monorepo at an earlier build, kept here to show how the settings above change the counts; it was not re-run for this wiki. The default reading found 275 entry points (7 of them message consumers): 116 internet-facing, 0 internal and 159 unknown.

Twenty routes of one service are internal in its production compose stack. Fourteen of them read internet-facing, because an end-to-end test stack in the repository has a gateway that routes to them, and six read unknown, because the repository's Terraform is not read. Listing the test stack under `security.not_deployed` removes the first reason and not the second: while the Terraform is there and not read, none of the twenty is called internal.

With the service's code tied to its target group as well (`security.terraform`), the twenty read internal, in the compose stack and in the Terraform: 102 internet-facing, 20 internal, 153 unknown. No listener rule forwards them to the service, and on the compose side the start script is read statement by statement, the application object has nothing unknown, and the eleven services that name it read as its clients. Three of the twenty could be reached through a frontend that relays to an address set outside the repository, if that address were the service's own: the tie does not read that, and the verdict says so.

## In a pull request

```bash
drift security --diff-base origin/main
```

reports only what the change introduces: entry points lacking a guard most of their siblings have, unguarded entry points reaching a risky operation, risky operations and client leaks added, and entry points made internet-facing. It exits 0 and is facts for review, unless a person asks otherwise: `--fail-on <kinds>` makes the run exit 1 when the change introduces one of the kinds named (`unguarded-reaching`, `no-guard`, `guard-gap`, `risky`, `leak`, `public`, or `any`), and says which on standard error. Nothing fails unless that flag is given.

```bash
drift security --diff-base origin/main --fail-on unguarded-reaching,public
```
 `--github` prints notice annotations and a job summary. The merge base is scanned in a temporary checkout, so an entry point that lacked the guard before the change, or was renamed, is not reported. The GitHub Action runs this when asked (`security: "true"`, off by default until the shared-guard precision is measured), as notices that never fail the job; with `security-comment: "true"` (needs `pull-requests: write`) it posts the same text as one comment when the pull request introduces anything. See [Drift in CI](Drift-in-CI).

The text output looks like this (`--json` gives the same facts as data):

```
Security: what this change introduces (2 file(s) added or changed, against origin/main, merge base 3f2a9c1b0d4e). Facts for review: nothing here fails the check.

Entry points lacking a guard most of their siblings have
  app/api/open/route.ts:1 GET /api/open [http]: no guard found in what Drift read; withAuth is on 37 of 41 http entry points in app/api/
      to copy: app/api/r00/route.ts:3 GET
        export const GET = withAuth(async (req: Request) =› {

Entry points where Drift found no guard, reaching a risky operation
  app/api/run/route.ts:1 POST /api/run [http]: eval

Risky operations added
  eval  app/api/run/route.ts:1 POST
```

## How the pieces fit together

Drift prescribes no security rules. It tells you what your code protects, how consistently, and where a change slips from that, with the count to prove it:

1. **Inventory.** `drift security`: every entry point with its guards and where it is reachable from (compose files, `security:` in `.drift/config.yaml`), the risky operations each reaches, client leaks and environment reads. A guard is named only on the routes it runs for, and a route is called internal only on proof: what Drift met and did not read makes the answer unknown, with the reason.
2. **Shared guards.** Where 90% of the entry points of a kind in a place share a guard, the ones without it, with a member to copy from: "47 of 50 http entry points have `withAuth`; these 3 do not". Each names the convention that says the same, accepted or one `drift review --accept` away.
3. **The pull request.** `drift security --diff-base origin/main`: only what the change introduces, as notices, a job summary or one comment. A route that lacked the guard before the change is not news.
4. **The agent.** `drift card <path>` before it writes: the file's place, what its siblings carry, one to copy, and what is not known. `drift_security` and `drift_card` over MCP give the same.
5. **The rule.** Accept the convention and `drift check` blocks the next one.

Nothing in this is a shipped rule: the guards, the populations and the exceptions are the repository's own, and every report ends with what it does not cover. Drift is a guardrail, not a security control, and says so.

Two things make this possible. Mining learns your guards and boundaries the same way it learns anything else ("HTTP handlers in `app/api/**` are wrapped in `withWorkspace()`", "`packages/ui/**` never imports `next`", "handlers call `requireUser()` before `db.query()`", "functions in `lib/**` do not read `process.env` directly"; see [Conventions and Review](Conventions-and-Review)). And `drift security` lists what the code does, for a person to review.

A file's card (`drift card <path>`) gives an agent the same facts for one file: its package, its entry points with their guards and exposure, the risky operations it holds or reaches, its env reads and client leaks, what its siblings of the same kind in the narrowest place with 8 or more of them carry (with one to copy from), the accepted conventions covering it, and what Drift does not know. See [Command Reference](Command-Reference).

## What it does not cover

Checks inside handler bodies other than sign-in checks, whether the caller may act on the record it asks for, rate limits, and anything applied outside the repository (gateways, proxies, platform settings). A shared guard is what the repository does, not a verdict on its exceptions. A `.drift/conventions.yaml` that does not parse costs only the links from shared guards to conventions: the inventory is listed with a warning naming the error.

See also: [How Drift Works](How-Drift-Works), [Practices Map](Practices-Map), [Setup Questions](Setup-Questions), [Drift in CI](Drift-in-CI), [Languages and Frameworks](Languages-and-Frameworks), [Security and Privacy](Security-and-Privacy).
