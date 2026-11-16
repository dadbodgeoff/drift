# Practices Map

This page explains `drift practices`: the map of what the codebase does for each cross-cutting concern, how to read its states, reasons and obligations, how to declare what Drift cannot classify alone, what the hints are, and how a person turns one practice into a rule for new code. It is for engineers and reviewers who want to see how consistently routes authenticate, authorize, validate and handle errors, and for anyone who needs to read an `unknown` or a `none` correctly.

The practice map says what the code does. `drift practices` itself is read-only, exits 0 and never blocks, and nothing in the map is checked on its own. A person can make one practice the rule for new code in one place with one command, `drift practices promote`: it writes an accepted convention, and from then on `drift check` holds new code there to it like any other convention. See [Promoting a practice to a convention](#promoting-a-practice-to-a-convention).

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
| `partly_read` | a function the unit runs was read except for a method of a value whose type Drift does not know; the instrument is that function |
| `forwarded` | the request is handed on to another service over HTTP; the instrument is the function that hands it on |
| `signature_not_proven` | a webhook signature verifier is called, but its failure does not provably leave the handler |
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
| `other_read_unscoped` | a filter by the caller scopes its own query, and another query of the route selects rows by nothing of the caller |

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

## Promoting a practice to a convention

The map can tell you "38 of 40 routes in `app/api` sign the caller in with `withAuth`, 2 do not". Promoting that practice says "yes, that is our rule here: hold new code to it". It is one command:

```bash
drift practices promote P-0f0acb --in app/api
```

`P-0f0acb` is the variant's id, as `drift practices --all` or `drift practices --json` (`concerns[].variants[].id`) prints it. `--in` names the place. The command prints a preview, writes one convention to `.drift/conventions.yaml` and one line per existing exception to `drift.lock`, and ends with `Wrote .drift/conventions.yaml and drift.lock.` Add `--dry-run` to see the preview and write nothing. Every flag is on [Command Reference](Command-Reference#drift-practices-promote).

The examples in this section are on the sample repository the [README](https://github.com/dadbodgeoff/drift/blob/main/README.md#a-five-minute-first-run) uses (built by `npm/dry-run.sh`): 40 route files `app/api/r00` to `app/api/r39`, of which 38 are wrapped in `withAuth` and `r38` and `r39` are not. The preview there:

```
Sign-in in app/api: wrapped in withAuth in 38 of 40 entry points.
  2 do not, and are recorded as they are (app/api/r38/route.ts:1 GET, app/api/r39/route.ts:1 GET).
  0 could not be read; those are never reported.
From now on `drift check` reports a new entry point here that does it another way, or not at all.
Mode: advise (it never fails a check). `drift practices promote P-0f0acb --in app/api --block` makes it fail one, when the 15 entry points added here most recently follow it.
Also in .drift/conventions.yaml: D-37416b names the same way for code of this package. Where both are accepted, new code that breaks them is reported under each; `drift review --reject <id>` drops one.
Dry run: nothing was written.
```

The `Also in .drift/conventions.yaml` line appears when a mined convention, proposed or accepted, requires the same thing of code in the same package (here `D-37416b`, the proposal `drift init` made for `withAuth`). The two are checked separately, so with both accepted a new route that breaks them is reported twice. Keep the one you prefer: the mined rule matches the wrapper by name on route files, the promoted practice asks the classifier what each entry point does and accepts every way you named. `drift review --reject <id>` drops the other. With `--json` the ids are in `same_way`.

### What it writes

- **One accepted convention**, in advise mode, of the rule type `practice`. It stores the concern (`authn`), the place, and the accepted ways as variant keys (`wrap:lib/auth.ts#withAuth`), never as names. It records which variant it came from (`promoted_from_practice: P-0f0acb`) and is shown to agents (`agents: show`), because a person promoted it. It has an id like any convention (`D-` and six hex digits), taken from the place and the concern, so promoting again in the same place keeps the id.
- **One `drift.lock` line per unit that differs today**, `<id> <path>#<symbol>` (`<id> app/api/r38/route.ts#GET`). Code that already did it another way is recorded as it is, so `drift check` reports only new code. This is what `drift init` does for every mined convention.

It writes nothing else: no source file, no `.drift/config.yaml`.

### How the rule is checked

The rule is checked by the same classifier that draws the map, not by matching a name. For each unit of the concern in the place:

| The map says the unit | Result |
| --- | --- |
| does it one of the accepted ways | follows |
| does it another known way, is `identified` (reads the caller and turns no one away), or `none` | breaks it: a violation, unless it is in `drift.lock` or has a `drift-ignore` comment |
| `unknown` | **never reported.** Counted, and `drift check` says how many units it could not check |

So a unit Drift cannot read never becomes a violation, and "nothing found" is told apart from "could not tell".

**Doing more than the accepted way.** For sign-in (`authn`), permissions (`authz`), validation and responses (`api`), what a unit does adds up: a route that signs the caller in with the accepted guard and also checks something else still signs them in. There a unit follows when its uses include every use of an accepted way. For the other concerns (configuration, logging, data access, errors, testing) the extra use is itself the departure (a config value read in place beside the config module), so a unit follows only when what it does, as a whole, is an accepted way. `drift practices --json --units` lists each unit's separate `uses`.

**A whole mechanism, or any way that enforces.** The `practice` rule in `.drift/conventions.yaml` can hold two more fields beside `any_of`. `any_mechanism` lists mechanisms accepted whole, by the classifier's own names (`wrap`, `permission`, `dependency`, ...): for sign-in, permissions, validation and responses a unit follows when one of its uses is of such a mechanism, whatever instrument it names; for the other concerns, every one of its uses must be. A mechanism that cannot enforce (one that opens a route, one that only identifies the caller) is never offered whole. `any_enforcing: true` accepts any way the classifier says enforces the concern: for sign-in, a use that turns a caller away; for permissions, a check Drift proved. A unit with nothing found, or one that only identifies the caller, breaks it. Only sign-in and permissions have this notion. Both fields are absent unless set, and a unit Drift cannot tell is never a violation under them either. `drift practices promote --concern <id> --mechanism <name>` writes `any_mechanism`, and `drift practices promote --concern <id> --any-enforcing` writes `any_enforcing`; the variant id is then optional:

```bash
drift practices promote --concern authz --mechanism membership_guard --in app/api
drift practices promote --concern authn --any-enforcing --in app/api
```

A mechanism's name is the part before the `:` of a unit's uses in `drift practices --units --json`. A way that opens a route on purpose is never an enforcing way. A file holding either field is written as `version: 3`, which a Drift that reads up to version 2 refuses ([Versioning and Upgrades](Versioning-and-Upgrades#promoted-practices-and-older-drift)).

**Background jobs.** For sign-in and permissions, an entry point of kind `job` takes no request, so a promoted practice does not count, check or report it. The preview says how many were left out: `  N background jobs take no request and are not counted.` A way is what the map read, stored by its key (the file and symbol that define it), so a second helper that does the same job is a second way: add it with `--with`. A helper you declared in `.drift/config.yaml` under `practices:` is a known way like any other.

A violation of a promoted practice is reported like any other violation, in `drift check` and in CI, and counts toward the exit code by its mode. To make an exception on purpose, put `// drift-ignore <id>: <reason>` (`#` in Python) directly above the declaration; a reason is required.

### What may be promoted

Drift decides from counts in the place, never from names. A practice may be promoted in a place when all three hold:

| Count | Needed | Why |
| --- | --- | --- |
| Units of the concern in the place that Drift could read (follows plus differs) | at least **8** | fewer is not a practice, it is a handful of files |
| Share of those readable units that do it one of the accepted ways | at least **80%** | the same share the map uses for "departs from" |
| Share of all units in the place that are `unknown` | at most **20%** | Drift cannot hold code to what it cannot read |

On the sample repository: 40 entry points in `app/api`, 0 unknown, 38 of 40 (95%) use `withAuth`. It qualifies.

When more than 20% are unknown, the refusal says so: `In <place>, Drift cannot tell how <unknown> of the <total> do it (<pct>%, more than 20%): it cannot hold code to what it cannot read.` When every unknown unit, two or more, is unknown for one cause outside them (the same reason and the same instrument, which no unit's own file holds), it names that cause instead of pointing at `drift practices --hints`:

```text
All <n> are unknown for one cause outside them: a wrapper Drift cannot see into (`<instrument>`). This line in .drift/config.yaml would let Drift read it: `<line>`.
```

The cause is one of: `a call whose body Drift cannot read`, `a wrapper Drift cannot see into`, `a name that does not resolve`, `a method of a value whose type Drift does not know`, `a file that was not parsed`. Where no `.drift/config.yaml` line names it, the sentence ends `No .drift/config.yaml line names it: once Drift reads that call, they can be told.` The preview of a practice that does qualify prints the same sentence when its unknown units share one cause. The 20% is not moved by it: the place is still refused.

**A way of doing nothing.** Some ways are what code does by doing nothing: errors that all bubble up to the framework, or logging only with a built-in logger. A practice of such a way holds new code to nothing it has to try for, and the preview says so: `This is what code here does by doing nothing: new code follows it without trying, so the rule reports only code that does something else.`

`drift practices promote --list` lists every practice that qualifies now, one line each with the command to run. Each variant is listed at its broadest place that qualifies: the package, or a directory of it only where the package as a whole does not qualify.

```
3 practice(s) may be promoted now. Each becomes an accepted convention in advise mode, with the code that differs today recorded in drift.lock; the command prints what it records (--dry-run writes nothing):
  sign-in in .: wrapped in withAuth in 38 of 40 entry points; 2 differ, 0 could not be read
    drift practices promote P-0f0acb --in .
  errors in .: left to the framework in 40 of 40 entry points; 0 differ, 0 could not be read
    drift practices promote P-6123b9 --in .
  responses in .: built with Response.json in 40 of 40 entry points; 0 differ, 0 could not be read
    drift practices promote P-9fdb90 --in .
```

If you leave out `--in`, Drift promotes the variant in its broadest place that qualifies. If none does, it refuses and says which place came nearest and why that one fails. Every refusal exits 2, says why in one sentence on standard error and writes nothing. The refusals and what to do about each are on [Troubleshooting](Troubleshooting#a-practice-cannot-be-promoted).

### Places

A place is a package, or one directory of a package. A unit is in the place when its file is in that directory or below it. `--in` takes a path from the repository root (`app/api`, `apps/web/app/api`, `.` for the root package); the longest package that holds the path is the package, and the rest is the directory.

Two narrower places can be named too:

- **One file.** A path that is the file of a unit is that one file (`in_file` in `.drift/conventions.yaml`): "every route in this router signs the caller in this way".
- **A route prefix.** A package, `:` and a literal route prefix (`apps/api:/api/v2`, `.:/api/workspaces/<slug>` for the root package; `under_route` in the policy) is the routes of that package under the prefix, each parameter matching any parameter and written `[*]`. A unit is in it only when Drift read its route to the end as a literal; one whose route Drift did not read so is never in it and is counted as not read wherever it could be under the prefix (the preview says how many, and `candidate.unread_routes` in `--json`).

Output names a route place `<package>:<prefix>`, and a command Drift prints puts a file or route place in single quotes when it holds a character a shell reads. A file holding a file or route place is written as `version: 3` (see above). Two places overlap when one holds the other: a directory and a file in it, the same file, one route prefix and a longer one, or a route place and its whole package.

### More than one accepted way: `--with`

Some places accept two ways (a policy with alternatives: one guard or another). Add each further variant of the same concern with `--with`:

```bash
drift practices promote P-0f0acb --in app/api --with <another P-id of the same concern>
```

The ways' units count together toward the 80%. The preview lists the other known ways units of the place use, so you can see what `--with` could add. A variant of another concern is refused.

**A route that is open on purpose.** Some frameworks mark a route as public by design (`AllowAny`, `@Public()`, a middleware's public list); the map records that as its own way, `opens`. Drift never counts it as following the rule unless you add it yourself with `--with`: the preview lists it among the other ways, and adding it is your decision. Without it, a new route marked open in that place is reported. A single route that is public for its own reason is better settled with a `drift-ignore` comment and a reason.

### Promoting again

Running `drift practices promote` again for the same concern in the same place updates that convention, under the same id. The accepted ways become the set you give now, units that differ under the new set are added to `drift.lock`, and the mode a person chose is kept unless you pass `--block`.

### Stale: the way is gone

If no unit of the place uses any accepted way any more (the guard was renamed or replaced), the convention is **stale**. `drift check` says so, and the convention fires on nothing until a person looks at it. A rename never turns into forty violations. Promote the new way in the same place to replace the old one (same id), or reject the convention with `drift review --reject <id>`. On the sample repository, after renaming `withAuth` to `requireAuth` in `lib/auth.ts` and in every route:

```
drift: no new violations (0 legacy, baselined)
drift: [D-d67d54] promoted practice is stale: none of the 40 Drift read in app/api does it an accepted way any more (Sign-in in app/api: wrapped in withAuth), so it reports nothing until a person looks. To accept the way the code does it now: `drift practices promote <P-id> --in app/api` again (`drift practices promote --list` shows what may be promoted); to drop it: `drift review --reject D-d67d54`
drift: practices (facts, not rules; they never fail the check): 2 file(s) do a concern differently from the entry points around them
  app/api/r38/route.ts: authn: 38 of the 39 other entry points in app/api use wrap requireAuth [P-75e3fc]; here GET:1 does: none: no guard found in what Drift read (copy app/api/r00/route.ts:3 GET)
  app/api/r39/route.ts: authn: 38 of the 39 other entry points in app/api use wrap requireAuth [P-75e3fc]; here GET:1 does: none: no guard found in what Drift read (copy app/api/r00/route.ts:3 GET)
```

A stale convention never fails a check.

### Below the share: `--force`

It is your codebase. `--force` promotes a practice whose ways hold less than 80% of the readable units. It lifts only that one condition: the place still needs 8 readable units and at most 20% unknown. A forced practice advises only and never blocks, now or later; `--block --force` is an error.

### Block mode and the replay

A promoted practice starts in advise mode: it is reported and never fails a check. To make it fail `drift check`, and with it CI and the pre-commit hook, promote it with `--block`:

```bash
drift practices promote P-0f0acb --in app/api --block
```

Drift allows block mode only on evidence of recent work: a **replay**. It takes the 15 units most recently added to the place that the map can tell, ordered by the commit that first added each unit's file, and counts how many follow the practice. Block mode needs at least 80% of them (12 of 15). Drift prints the count either way, and writes nothing when block is refused.

```
Sign-in in app/api: wrapped in withAuth in 38 of 40 entry points.
  2 do not, and are recorded as they are (app/api/r38/route.ts:1 GET, app/api/r39/route.ts:1 GET).
  0 could not be read; those are never reported.
From now on `drift check` reports a new entry point here that does it another way, or not at all.
Mode: block (a new one fails the check). `drift review --advise D-d67d54` makes it advise.
Also in .drift/conventions.yaml: D-37416b names the same way for code of this package. Where both are accepted, new code that breaks them is reported under each; `drift review --reject <id>` drops one.
Block: of the last 15 entry points added here, 15 follow it as they stand, so it blocks from now on (`drift review --advise D-d67d54` sets it back).
Dry run: nothing was written.
```

What the replay measures, and what it does not:

- It reads the units **as they stand now**, not as they were when they were committed. A route added unguarded and fixed later counts as following. It asks "does recent work here follow the practice today", not "would the rule have fired on each past commit".
- "Most recently added" is by the commit that first added the unit's file. A unit added to an old file counts at that old file's date. Ties are broken by path and line.
- It needs git history. With no git, or a file whose first commit Drift cannot find, those units are not read; with fewer than 15 units read, block is refused with the reason. Run it from a full clone: a shallow clone does not hold the commits that first added most files.

Advise mode needs no history and always works. `drift review --advise <id>` returns a promoted practice to advise mode, as for any convention.

### Python advises only

A place whose units are Python advises only, as every Python convention does (decision D7; see [Conventions and Review](Conventions-and-Review#tiers)). It can be promoted, in advise mode; `--block` does not make it block.

### Other places to do it

- **`drift review`** offers each practice that qualifies, after the mined proposals: `y` promote (advise), `b` promote in block mode, `n` no, `s` skip, `q` quit. See [Conventions and Review](Conventions-and-Review#practices-that-may-be-promoted).
- **The Studio** has the same step in its Practices view, with the same preview.
- **`drift init`** proposes the strongest practices that qualify, as proposals from the map: written `proposed`, in advise mode, labelled as coming from the map, not baselined and shown to no agent until a person accepts one in `drift review`. Accepting one writes it as `drift practices promote` would. See [Proposals from the map](Conventions-and-Review#proposals-from-the-map).
- **`drift check`** ends a practice departure with the promote command for its place, where the command would take it as the code stands (`; to make it the rule for new code there: `drift practices promote <id> --in <place>``). Agents are not given it.

### Undoing it

A promoted practice is an ordinary convention once written. `drift review --reject <id>` rejects it; `drift review --advise <id>` returns it to advise mode. As the code is fixed, its lock lines are listed as `fixed` by `drift check --format json`, as for any convention.

## Where else the map shows up

- **`drift card <file>`** has a "Practices here" section.
- **Agents** get the recipe once before they write a new entry-point file, and are told after an edit when a file's entry points do a concern another way than at least 80% of those around them. See [Using Drift with Agents](Using-Drift-with-Agents). These are facts the agent is told; a practice is held as a rule only once a person promotes it.
- **`drift check`** prints, under its own heading and after the exit code is decided, the concerns the checked files do differently from their neighbours, for the files it looked at (every file, the files named, or with `--diff-base` the files the diff added or changed). A route that does all its neighbours do and more is not one, a health probe is compared in no concern, and a one-off route is said with what it does itself. These never change the exit code: `practices.departures` in `--format json`, notices and a job-summary section in `--format github`, run notifications (not results) in `--format sarif`. A practice a person promoted is different: it is a convention, and its violations are reported with the others (see [Promoting a practice to a convention](#promoting-a-practice-to-a-convention)).
- **`drift init`** leads with the map, whether or not any convention is proposed: the three largest kinds of entry point with their counts, and at most five findings under `Worth a look first`.

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

- **A role or the comparison.** A comparison that is one operand of an `and` whose other operands test that the caller lacks a role (`if not caller.is_admin and row.owner_id != caller.id: abort(403)`, `if not (caller.is_admin or row.owner_id == caller.id)`, `if (!req.user.isAdmin && post.ownerId !== req.user.id) return 403`) decides every request: a caller with the role passes by the role, and every other caller is compared with the row. Where the comparison is an owner's and the role is read off the caller, it is the route's check: the unit is `known`, and the check is named with its alternative (`owner_check:... or a role`), so the bypass is never hidden. Where the other operand is anything else (a flag of the row, a value the request sent, a third condition), requests pass for a reason that is no authorization, and the check stays found, not proven (`and_operand`). So does a tenant's comparison beside a role (`role !== "admin" && rule.orgId !== req.user.orgId`): the role lets its holder into every tenant, which is for a person to look at. A value named for an owner and compared with another value (`row.owner_id != caller.id`) is an owner check; `owner` as a role's name (`member.role == "owner"`) is a role.
- **A value of the caller handed on (TypeScript).** A query filtered by a parameter of the function it is in (`where: { userId }` in `listNotes(userId)`, or in a method of an injected service or a repository) is filtered by whatever the route's own bodies pass for that parameter. The lowering says what each call hands the repository's code, argument by argument (the caller's own value, a parameter, a literal), and which parameter each filter value is read off; the map follows the parameter up the calls of the route, hop by hop. Passed a value of the caller (`this.notes.listFor(user.id)` with `@GetUser() user`, `listNotes(req.user.id)`), the filter is the route's scope: `known`, as a filter written in the handler is. Passed what the request chose (`listNotes(req.params.userId)`), a value that is not read, or by a call the map does not see, it proves nothing, so the same method is the scope of one route and not of another. A value handed over inside an object written in place (`list({ userId: user.id })`) is not followed yet.
- **The caller's own record, and nothing else (Python).** A handler that hands back what gives the caller wherever it returns a value (`def read_user_me(current_user: CurrentUser): return current_user`), whose own body is the only one the route runs, and that calls nothing of the repository and nothing of a data library, serves the caller's own record: there is no one else's to ask about. The route reads `known` (`own_record`), by its body and not by being named `/me`; one that also reads rows does not.
- **The caller's own record handed to the session (Python).** A route whose bodies hand a data session the caller itself and nothing else (`current_user.hashed_password = ...; session.add(current_user); session.commit()`, `session.delete(current_user)`) changes the caller's own record and no one else's, read as `own_record`. Read from what each call on a session is handed, whether the session is a name annotated as one (`SessionDep = Annotated[Session, Depends(get_db)]`), a parameter the package types (`db: Session = Depends(get_db)`) a binding built from a data library, or the binding the repository's own models are declared on (`db.session` where `class Note(db.Model)`, Flask-SQLAlchemy's shape, whatever built `db` and whatever it is called); a call handed nothing (`commit()`) picks no rows. Proven where every body of the route was read, no call on a data session is handed anything else, and no body reads rows by nothing of the caller; beside one that does (a look-up of another user by the email the request sent), found, not proven (`other_read_unscoped`). A client of no data library (a cache, a mailer) is no session.
- **A row created as the caller's own (Python).** A row of a model of the repository built with one of the model's fields given the caller itself (`Thing(title=body.title, owner_id=current_user.id)`) and handed to the session is the caller's, read as `owner_stamp:<field> (session)`: the field's value says whose the row is, whatever the field is called and whatever else the request sent. Every build of the model in the body must give the field so. Nothing where the request chose the owner (`owner_id=body.owner_id`: the route reads `none`), where a group or a setting of the caller is given (`current_user.team_id`), where the body writes the field again afterwards by anything else (`thing.owner_id = body.owner_id`), or where a dict has something unpacked into it. A field given through a method of the model the facts do not hold (`Item.model_validate(item_in, update={"owner_id": current_user.id})`: what the method does with the dict is the package's to say) is found, not proven (`callee_unread`), and can be declared.
- **A class named for the caller is a class (Python).** A bare name a file imports that says the caller is the caller where a package gives it (`current_user` of flask_login); where it is a class of the repository (`from app.models import User`, then `select(User)`, `session.get(User, user_id)`) it is that class, and what is handed it is not the caller itself.
- **The caller's own record, or the check (Python).** A check that comes after a branch that returned without refusing is asked of the requests that did not take the branch. Where every such branch of the body tests that what the request is about is the caller's own record (`==` or `is` between the caller itself, or the key of the caller's record, and something else: `if user == current_user: return user`, `if user_id == request.user.id: ...`), every request is either about the caller's own record or passes the check: the check is the route's, named with what it stands beside (`role_check:... or the caller's own`). One more branch that returns for any other reason (`if preview: return user`) lets requests through that are neither, and the check stays found, not proven (`after_conditional_return`).
- **A lookup of the caller in what the request names (Python).** A guard that lets a request through only after a query found a row for the caller in what the request names is that check, named `membership_guard` ("a membership check"), whatever the guard, the model or the keys are called. The body is read, by its paths: every place a decorator's wrapper calls the view, every `return` of a guard function that does not refuse, every `return` of a DRF permission class's `has_permission` that may answer true, must be reached only where such a lookup held: under an `if` on it, after an `if` that left the function where it did not hold (`if not Member.objects.filter(member=request.user, workspace__slug=kwargs["slug"]).exists(): return Response(status=403)`), through a local bound to it, as an operand of an `and`, by `is not None` said of it. The lookup is a query that, in every call the body makes of it, is given a value of the caller under one key and a value read off a parameter or off what the request sent under another. A place nothing held at (`return True` for some requests, the view called under no test, an `or` beside the lookup), a query the caller is no part of, and a lookup that names nothing of the request (any row of the caller's anywhere) prove nothing: the guard stays what its name alone says, found and not proven. `if request.user.is_anonymous: return False` at the top of such a test is the sign-in test said of who is not signed in: the class authenticates. The lookup may be written on a session a dependency gives (`seat = db.query(Seat).filter_by(holder_id=user.id, space=space).first()`, then `if seat is None: raise HTTPException(403)` in a FastAPI dependency): it is read off the rows the statement names. A query made on what such a lookup handed back (`members = Member.objects.filter(member=request.user, workspace__slug=slug)`, then `members.filter(role=ADMIN).exists()`) narrows the rows it found and is read with it: the result is selected by what every link of the chain is given, so the caller may be given in any of them (`.filter(workspace__slug=slug).filter(member=request.user)`); a link that leaves rows out (`exclude`) adds nothing.
- **DRF `get_permissions`.** A view that chooses its permission classes in `get_permissions` is read handler by handler where the method's body is nothing but tests of the request's method or the view's action, each answered by a list of classes (`if self.request.method in SAFE_METHODS: return [Member()]`, then `return [Admin()]`; `if self.action == "create": ...`; a name bound to a list in each branch and returned instantiated; `super().get_permissions()` for the view's `permission_classes`). Each handler is guarded by the classes of the case its method and its action take; what a base declares, the settings' default and the `permission_classes` the view itself declares do not run beside what the method returns, so a read the method opens with `AllowAny` has no guard whatever the class declares. A body that does anything else is not read: the handler's permissions are unknown, as before.
- **A refusal the map cannot name, beside a proven check.** A 403 on something that names neither a role, a tenant nor an owner (`if note.space == "archive": raise HTTPException(403)`) may be the authorization, so a route with nothing else reads unknown. Behind a check every request passes (a role guard, a membership check, an owner filter) it turns more requests away, never fewer: the route reads `known` by that check.
- **Rows found by the caller itself (Python).** A query given the caller itself, or the key of the caller's record, under a key finds this caller's rows and no one else's, however the query is written: a keyword (`FileAsset.objects.get(id=asset_id, user_id=request.user.id)`, `Seat.objects.filter(holder=request.user)`, `filter_by(venue_id=get_jwt_identity())`) or a comparison (`select(Item).where(Item.owner_id == current_user.id)`, `db.query(Seat).filter(Seat.holder_id == user.id)`). The route is scoped by the value, whatever the key is called (`owner_filter:<key> (session)`). It proves the route only where every statement of the route's bodies that reads rows of a model of the repository reads them so, or by a value read off rows that were (`Comment.objects.filter(doc=doc)` after `doc` was read by the caller), and no body reads rows Drift cannot resolve (a method of a local queryset, `self.get_queryset()`). A filter under an `or`, a `Q(...)` or a negation narrows nothing and is not read as one. One query by the caller beside another by what the request sent alone (`Pref.objects.get(user=request.user)`, then `Doc.objects.get(pk=pk)`) scopes the first, not what the route reads: found, not proven. What is read off the caller (`request.user.org_id`, a claim, a session item) says a group or a setting of the caller, not the caller: under a key that names no tenant it stays found and not proven, as before.
- **What counts as a change of data** is what the request asked the route to change: a guard's own bookkeeping before its refusal (a session refreshed, the caller's record mirrored) is not the route's effect. Whether a call changes data is read by following the repository's own functions three calls deep, and otherwise from the first word of its name; the line names the call that was taken as the write, so a wrong guess is visible.
- **Also found and not proven:** a check only its name says is one (a helper, or a guard or permission class of the repository whose body is not read to refuse), and a query filtered by a tenant or owner key whose value's source Drift does not know (every such TypeScript query today). In TypeScript it is also said of a check in a callback or a local function that only some requests reach, in a function kept in a table (`table[req.method]()`), in a sibling method called through `this` under a branch, and of a comparison where neither side is read off the caller (`params.orgId !== body.orgId`).
- A file's card repeats the line for its first such unit.

### A value of the caller

A handler that hands a value of the caller to a query or to code that uses it (`Shipment.objects.visible_to(request.user)`, `load(id, g.user.venue_id)`), compares one with a row's (`if s.depot_id != request.user.depot_id: continue`) or reads rows through the caller (`request.user.depot.shipments.all()`) is unknown for authorization, with the callee named, never `none`: the key need not be named for a tenant. A tenant filter's answer does not depend on the column's name: a key on no list (`org_id` or any other name) reads the same, and an unlisted key reads unknown, never `none`. None of this makes a unit `known`. A comparison with one before any refusal (`abort(404)`, a custom exception, a 400) is unknown too.

- **Python.** A value of the caller is read off a closed list of sources: a path named for a subject (`current_user`, `g.user`, `request.user`, `request.auth`, `session[...]`), what `g` or `request.state` keeps under a user-like name (`g.principal`, `request.state.claims`), `request.scope["user"]`, a claims accessor called with nothing (`get_jwt()["venue_id"]`, `get_jwt_identity()`), what a dependency that signs the caller in gives, a local assigned from any of these, what a function of the repository called with nothing or with the request hands back where its body returns one (`def current_venue_id(): return get_jwt()["venue_id"]`), and what a hook or middleware of the repository binds on `g` or `request.state` under any name. What a dependency gives counts only where the dependency signs the caller in: a comparison with a value of `Depends(get_db)` scopes nothing. DRF permission classes that are not a list written in place (`BASE + (X,)`, `A | B`, `get_permissions`, an action's own) are unknown.
- **A lookup of the caller among rows a literal picks is a role (Python).** A guard that lets a request through only where a query found the caller under one key and a literal under another, and nothing the request names (`return InstanceAdmin.objects.filter(role__gte=15, user=request.user).exists()` in a DRF permission class, the same in a decorator's wrapper or a dependency), is a role guard read from its body: the caller holds a place no request chose, whatever the model and the keys are called. A lookup of the caller under no other key says only that the caller has some row, and one with no caller in it says nothing of who calls: neither is proven. The caller is the caller whatever the request parameter is annotated with (`def delete(self, request: Request, pk: str)`).
- **The caller's own rows, or a role (Python).** `if current_user.is_superuser: rows = select(Item) ... else: rows = select(Item).where(Item.owner_id == current_user.id)` is the route's owner filter, named `owner_filter:<key> (session) or a role`: rows read whole in a branch taken on a member of the caller that is set or is a literal (the `else` of `if not user.is_admin:` too) are read for the callers the role lets through, where the same rows are read by the caller itself everywhere else. A branch taken on what the request sent (`if everything:`), on the key of the caller's own record (`if user.id:`), or on what says only that a caller is signed in (`is_active`, `is_authenticated`) lets every caller through and proves nothing. A class built on a data library that the facts hold as no table (a SQLModel class without `table=True`, the shape a response is validated into) reads no rows: `ItemPublic.model_validate(item)` is no query.
- **A role guard read from what a builder's step is given (TypeScript).** `export const adminProcedure = publicProcedure.use(isAdmin)` is a role guard where the function the step is given refuses on a role for every request (`if (ctx.user?.role !== "ADMIN") throw ...`), or where the binding it is built from does. A member of the caller compared with a literal is a role whatever the refusal is answered with: tRPC code that answers `UNAUTHORIZED` to a caller who is no admin asks a role all the same. A role asked only where the request says so (`input.strict && ...`) stays found by its name, not proven.
- **Bodies read further (TypeScript).** A method called on a local a class of the repository builds (`const repo = new NoteRepository(db); repo.listFor(user.id)`) is read as that class's own method, with what it is handed, so a filter in it is the route's where the route gives it the caller. A client a Prisma schema says is generated into a directory of the repository (`generator client { output = "./generated/prisma" }`) is the database client though no file of it is committed, and so is a binding built on one. A binding made by a method of a binding that is itself built from a library alone (`const log = logger.child({ ... })`) is the library's. An extended Prisma client (`$extends`) may filter every query: a route that filters by nothing on one stays unknown.
- **A value of the caller handed inside an object (TypeScript).** `listNotes({ userId: req.user.id, take: 20 })` hands the caller's value under `userId`; the callee that filters by `opts.userId`, by `({ userId })` where the parameter is declared, or by `const { userId } = opts` is followed as one that takes it by position. An object a spread or a computed key is written in hands on nothing by key (either may put anything under any key), a key written twice holds what was written last, and the caller's value under another key than the one the query filters by proves nothing.
- **A TypeScript query filtered by the caller's own value.** `prisma.note.findMany({ where: { userId: req.user.id } })` is the route's owner filter (`owner_filter:where.userId (session)`), and a tenant key filtered the same way its tenancy filter, where the value is the caller's by its own source (the closed list below; not what only may give one), the key is named for an owner or a tenant, and every request to the body reaches the call. A filter under a branch, after a return that serves, or by what the request sent stays found, not proven.
- **Every query of a TypeScript route, not one.** A filter by the caller scopes its own query. The route reads `owner_filter` or `tenancy_filter` only where every query of its own work selects rows by the caller: a query handed a filter (`where: { ... }`, the object a builder's `where` is given) holds one value that is the caller's, is read off rows another query of the same body selected by the caller (`where: { noteId: note.id }` after `note = findFirst({ where: { userId: req.user.id } })`, an item of them, what a promise of them settled to), or is what every calling body passed that is one. A value under a negation or a comparison that is no equality (`NOT`, `none`, `notIn`, `lt`) narrows nothing; a list of alternatives (`OR: [...]`) narrows where every one of them does (the caller's own, or the caller's teams'). A spread of an object whose keys are written in the file puts those keys and no other; any other spread, and a computed key, may put anything under what was written before it. A model of a database client called with no filter selects every row (`findMany()`, `findMany({ select })`); a call handed only the row it writes (`create({ data })`) selects none. A query reached through a parameter, `this` or a local is judged the same way, and a method called on `this` hands on what it is given. Where one query selects rows by nothing of the caller the filter is found, not proven (`other_read_unscoped`), and the line names that query: `prisma.note.count({ where: { userId } })` beside `prisma.note.findUnique({ where: { id: req.params.id } })` hands out any row by its id. What the callee the route signs the caller in by reads is how the caller is identified, and is not asked. A query no fact records as one (a builder compared by a function, SQL as text) is not judged here: the route is unknown by what reads those.
- **A helper gives the caller by what it returns (TypeScript).** A function of the repository whose every `return` that gives a value gives a value of the caller, what was made of the credential the request carries, or what another such function handed back where it was called with nothing or with the request (`requireSeat(request)` returning what `seatOf(request)` gave), a few calls deep, gives the caller: what a call of it hands back is the caller's value wherever it goes, whatever the function is called. One that returns what the request chose (a query parameter, a path segment) or one of its own parameters gives nothing of the caller.
- **Who calls, by no name (TypeScript).** A name says what something is called, not what it is. A function of the repository a body takes for the caller by its name (`getUser(req)`, `getSession(req)`) is read by its own body, as any helper above: where it gives the caller, what it handed back is the caller's; where it hands back a row the request names or what the request sent, a filter by it is found, not proven (`sides_not_caller_and_resource`). A package's accessor is what its package documents, and stays read by name. A parameter named for the caller (`user`, `session`) is whatever was passed: in a helper, a filter by it is the caller's where every call of the route passes a value of the caller there (`listFor(req.user)`, `listByOptions({ user: req.user })`), and not where one passes what the request sent; in a callback it is what the list held. In the route's own handler it is the caller's where a wrapper of the repository around the route hands the function it was given a value of the caller at that place (`handler(req, res, currentUser(req))` in `withUser(handler)`, around `export const GET = withUser(...)` or `app.get("/notes", withUser(...))`), and what the request sent otherwise. What a function reads back from a keyed store of its file (`CACHE.get(key)` of a `Map` the module keeps) is what the file put there: the caller's where every `set` of that store in the file puts a value of the caller under a key of the caller's and the module does not export the store, so a function that memoises a verified session gives the caller; over a store another body fills with anything else it gives nothing.
- **What a body bound on the request, and a method's own body (TypeScript).** A key named for the caller on the request (`req.user`, `ctx.state.session`) is who calls by what a middleware put there. Where a body that runs around the route (a middleware of the application, of the mount or of the route, a wrapper, the route's own body or what it calls) binds that key to what the request sent, what a later body reads under it is what the request chose: `req.user = req.body.user`, an object written with such a value (`{ id: req.headers["x-user-id"] }`), a fallback to one (`req.user = req.user || { id: req.query.as }`), or the row a call is asked for by its own key (`id`, `pk`, `sub`, `_id`) with such a value (`findUnique({ where: { id: req.headers["x-user-id"] } })`: a record's key identifies it and is no secret). Everything a body that reads the key proves by the caller's value is then found, not proven (`sides_not_caller_and_resource`). Only for the routes the binder runs around, and not for a row found by a key the caller was issued (`where: { key: req.headers["x-api-key"] }`), by the credential the request carries (a cookie, `Authorization`), or by anything a call made of the value that is not read here. A method taken for the caller by its name is read by its own body as a function is: one an object of the repository holds (`auth.getUser(req)` of `export const auth = { getUser(req) { ... } }`) and one of an instance of a class of the repository a binding holds (`sessions.getSession(req)` of `const sessions = new Sessions()`). A method of what a package's call or class built is the package's, and a method reached through `this` or an injected field is still taken by its name.
- **Rows narrowed to the caller itself under any key (TypeScript).** A query narrowed to the caller itself is the route's owner filter whatever the key is called (`prisma.user.findUnique({ where: { id: userId } })`, `where: { target_type: { type, target: userId } }`), read as `owner_filter:<key> (session)`: the value says whose the rows are. The caller itself is the whole value of a helper that gives the caller and without which a request is refused (the helper turns away a request with no caller, or the calling body signs the caller in by it), or the key of a caller's record (`.id`, `.pk`, `.sub` of a value of the caller), the same reading as Python's. A group or a setting read off the caller (`session.user.kennelId`, the caller's locale) is a use, not the caller: under a key named for no owner or tenant it proves nothing. Neither does a value that reaches the filter through a helper's parameter under such a key, nor a filter written anywhere but in place in the call (a spread, a computed key, a filter under a condition). Under a key named for an owner or a tenant, a filter in every call of the query the body makes, on whatever path, counts as one every request reaches (`if (intent === "delete") await prisma.passkey.delete({ where: { id, userId } })`): a request that takes no such path makes no call of it. Each proves the route only where every query of its own work selects rows by the caller, as above; a value under a negation or beside an alternative that is anyone's narrows nothing.
- **A refusal where no row of the caller's own meets a condition (TypeScript).** `const user = await prisma.user.findFirst({ where: { id: userId, roles: { some: { name } } } }); if (!user) throw new Response("Forbidden", { status: 403 });` is a role check (`role_check:where.roles.some.name`): the lookup is narrowed to the caller itself (as above), it holds a further condition, and the body refuses every request for which it found nothing. Proven where every further condition is fixed in the code (a literal there, or at every call of the helper: `requireUserWithRole(request, "admin")`); found, not proven, where one is anything else; nothing where the request chose one, and nothing where the refusal is the other way round (`if (user) throw`).
- **What identifies the caller proves no scope (TypeScript).** The rows a sign-in helper looks up to find who calls (the session a cookie's token names, the user a verified token names) are the caller's own record, not rows the route was asked for. A body is how the caller is identified where the calling body takes what it hands back as who calls, signs the caller in by its answer, or it gives the caller by what it returns; so is what it calls. A filter there counts as it did before the two rules above only: under a key named for an owner or a tenant, in a call every request reaches. A route that signs the caller in and does nothing else is not thereby authorized for what its path names.
- **A database client built in a factory (TypeScript).** `export const prisma = remember("prisma", () => { const client = new PrismaClient(); ...; return client })` binds what a call gave back for a function it was handed. Where every `return` of that function gives an instance it built of one class, a call through a member of the binding (`prisma.user.findMany`) is a call on that instance: a function has no such member. A factory that returns anything else (`{ client, started }`) is not read as the client.
- **A call only in what a body throws (TypeScript).** `throw redirect("/", { headers: { "set-cookie": await sessions.destroySession(session) } })`: no request the call ran for goes on, so what it may change is not changed before a check or a filter that follows (`after_effect` is not said of it). A `throw` inside a `try` may be caught and is not read so; the same call as a statement of its own is an effect as before.
- **A FastAPI dependency that loads the row the token names.** `def get_current_user(db: SessionDep, token: TokenDep): ... return db.get(User, claims.sub)` gives a value of the caller where every `return` reads its value off what its own dependencies gave it and each of those signs the caller in: the claims a token verifier hands back of the token (`jwt.decode`), an object built from them alone (`TokenPayload(**payload)`), and the row a primary key read off them names (`db.get(User, sub)`, `User.objects.get(pk=sub)`). A comparison with what such a dependency gives is then a comparison with the caller. A dependency that returns anything else (`db.get(User, 1)`) gives no value of the caller.
- **TypeScript and JavaScript.** A handler that hands a value of the caller to a query, a helper or a service (`eq(parcels.depotId, session.user.depotId)`, `listFor(req.user.depotId)`), compares one, switches or indexes by one, or puts one in a template given to a call is unknown for authorization with the use named, never `none`, whatever the column is called. The value is read off a closed list of sources (a sign-in accessor such as `auth()` or `getServerSession()`, `req.user`, `res.locals.user`, `c.get("user")`, `ctx.session`, a parameter decorated `@CurrentUser()`, a key a middleware of the repository binds on the request, what a function called with the request hands back) and followed through locals, callbacks, `then` and helpers that hand it back. Logging it, returning it, a rate-limit key and a presence test are no scope.
- **What keeps a route from `none`.** In TypeScript, a value of the caller carried by `nestjs-cls`, `AsyncLocalStorage`, a request-scoped provider, a module-level holder or a query object, an ORM-level filter, and a NestJS interceptor all keep authorization from `none`. A policy decision that nothing refuses on is found, not proven. In Python, what a repository configures outside the route is read as unknown, never as nothing: a FastAPI route class (`APIRouter(route_class=...)`), the `decorators` of a Flask-RESTX namespace or API and of a Flask-RESTful API, router options unpacked from a value, a decorator that hands the view back unchanged on some path, a Django `MIDDLEWARE` entry of a package Drift does not know, and a dependency replaced by `app.dependency_overrides` outside the tests. `method_decorator(..., name=...)` applies to the method it names only. A value of the caller kept outside the handler (a `ContextVar`, a thread-local, a module-level holder), a Django manager that overrides `get_queryset`, a database session variable set for row-level security, and a filter through a query API Drift does not read (Peewee) keep a route from `none`; a role compared from what the request sent (a header, a body field, a query parameter) is found, not proven.

### Sign-in guards in TypeScript and JavaScript

- **A guard whose only 401 is sent from a `catch`.** It is read by the shape of the function, in Fastify, Express, Hono, NestJS and Next.js: the `try` verifies before anything in it serves, the handler answers 401 and hands the request on nowhere, and the function goes on only past the `try`. A handler that swallows is no guard. A 401 under a further condition, a `try` under a branch, and a handler after which the request is handed on are found and not proven (unknown). A function of an object or a static method used as a guard is read for itself. `drift security` says of each such route what the practice map says.
- **A helper that returns its 401** (`NextResponse.json(..., { status: 401 })`, `c.json(..., 401)`, `{ error: <response> }`) guards a handler only where the handler returns what it was handed (`const denied = await requireSession(req); if (denied) return denied;`). Called as a statement of its own it guards nothing; used in any other way, unknown. A middleware that answers 401 in a branch and then still calls `next()` is found, not proven. A sign-in check that only some requests reach (after a return that serves, under a branch) is not proven, and neither is a Next.js middleware whose refusals all stand after such a return.
- **A 401 is no sign-in check by its status alone.** A check in a body that answers 401 (or sends to the sign-in page) is read as signing the caller in only where what it tests is the caller's: a value read off the caller (`req.user`, `ctx.session`, `session.userId`), what a library's session read or a function proven to give the caller hands back, or the credential the request carries (its `Authorization` header, a token cookie). A check on what the request sent in its body, query or path (an empty new password), or on the stored value such input is compared with in the same body (the CAPTCHA answer a row holds), is input validation and proves no sign-in, whatever it answers; a header of no credential's name, or a credential sent as input (`req.query.token`), is found, not proven. Each leaves the unit unknown where nothing else signs the caller in, never known and never none, since what else the body tests is not all read. A check you declare, one on a library's session read, and one on a value the facts say nothing of (what a helper of the repository hands back) are read as before.
- **One rule for what stands where a guard goes** (a middleware argument, a hook, a wrapper, a decorator, a tRPC procedure step): a function of the repository that turns every request away is a guard, one read to turn no one away is nothing, and everything else is unknown. A library's guard is known only in a call shape on a closed list (`crates/drift-core/src/guard_lists.rs`: passport, express-jwt, Hono's `jwt` / `bearerAuth` / `basicAuth`, `@nestjs/passport`, `@fastify/auth` and others, each with the options understood); a package on neither that list nor the list of what never authenticates, a value with no name, and a composition that is not read are unknown, never "no guard". A token verification called uncaught where a guard goes is unknown, not nothing. The practice map and `drift security` give the same answer for every TypeScript route.
- **A Nest guard that reads one key of the route's metadata.** A guard class that reads a key (`this.reflector.get(OnlyAllow, context.getHandler())`) and uses the value where Drift does not follow it (stored on the request, handed to a base class) answers to a decorator that sets that key and to no other: a route under a decorator that sets a different key is behind the guard as a route with no decorator is. A key that is not read as text or as a reference leaves every decorated route unknown, as before. A guard that extends `@nestjs/passport`'s `AuthGuard(...)` inherits a `canActivate` that reads no route metadata, so the base opens no route for one.
- **A method through a typed property (TypeScript).** A call through a property a class declares with a type (`this.db.prisma.note.count()` with `prisma: PrismaClient` on the injected `DbService`) is that type's method: a package's, or a class of the repository that is read. The property is followed by its declared type, not by its name.
- **Two values compared (TypeScript).** A comparison that refuses where the two sides differ records what each side is (a parameter, a field of what a call handed back). A helper or a service method whose comparison is between two of its parameters (`if (userId !== note.userId) throw new ForbiddenException()`) is the route's owner check where every caller on the way hands it the caller's own value on one side and a row it loaded on the other, whatever the method and its parameters are called. Handed a value the request chose, or refusing where the two match, it proves nothing and the route stays unknown.
- **NestJS.** The middleware a module applies in `configure` is the guard of the routes `forRoutes` covers and `exclude` does not, where it is written as literals; a variable, a pattern, a condition, or a path under a global prefix leaves those routes unknown. A guard registered with `app.useGlobalGuards(new Guard())` is read as an `APP_GUARD` provider is, wherever the call runs for every start of the application; under a condition, or given anything but a class built in place, the routes are unknown. An `APP_GUARD` provided by a factory or a condition is not read. `@Public()` (any `SetMetadata` decorator) opens a route only where the guard's `canActivate` is read to return true for the key it sets (`if (this.reflector.getAllAndOverride(KEY, [...])) return true;`); under a guard that is not read to honour it, such a route is unknown.
- **A response built as a value.** A response built and dropped (`NextResponse.json(...)` written as a statement of its own) refuses no one: a refusal counts only where it is returned. A function that only builds a response checks no one.
- **Providers and configuration Drift cannot follow.** A Nest `@Module` provider that is no object written in place is read for what it is bound to, and a binding of any name, a call, a member or a spread is not read. Where ORM configuration (filters, plugins and subscribers registered on queries), a Nest provider or a Next.js configuration handed to a wrapper Drift does not know is something Drift cannot follow, the routes it may reach read unknown, never `none`.
- **Fastify, Express, Hono, Next.js.** A listener written in front of an application (`http.createServer((req, res) => { ...; app(req, res) })`) is read as a middleware of that application, also when it is given by name, declared in the same file or imported. Fastify route options are read in order (the last writer of a hook wins; an unreadable spread after the hook is unknown). Fastify plugins exported with `module.exports` or `export default async function (app)`, routes a function registers under a condition, and routes registered in a loop or a `switch` are listed. A Next.js route the middleware guards is unknown where a rewrite in `next.config` reaches it from a path the matcher does not cover, and a Next.js configuration handed to a wrapper Drift does not know may add rewrites: the routes its middleware covers are then unknown. Routes under a Fastify plugin's `prefix`, a Hono `basePath`, or several paths (`app.use(["/a", "/b"], router)`, `@Controller(["a", "b"])`) are listed once per path.

### Sign-in guards in Python

What stands where a guard goes (a decorator, a FastAPI dependency, a Flask hook, a permission class, a base, a middleware) is read by one rule: a function of the repository by its body, a library by closed lists of the call shapes Drift understands (`crates/drift-mine/src/py_guards.rs`), and anything else as unknown. A library guard with an option that makes it optional (`jwt_required(optional=True)`, `HTTPBearer(auto_error=False)`) is not a guard; a package Drift has no list for is never read as no guard; a dependency that returns a 401 response instead of raising it refuses no one; a decorator written above the route decorator guards nothing; and a guard is read from its body, never from its name. The cases the inventory shares with this map (app-wide hooks, Starlette middleware, DRF and Django classes) are under "Guards, case by case" on [Security Inventory](Security-Inventory).

A route bound to a Python class (a Django or DRF class-based view, a Flask view class) is read through the method that runs, found in the order Python looks methods up in (C3), together with what the framework runs for every request before the handler (`setup` and `dispatch`; DRF's `initial` and `check_permissions`; Flask's `dispatch_request`). Where the order cannot be worked out (inconsistent bases, too deep), only the class's own methods are read and the unit is unknown. A package's class that may define the method before the one that has the check makes the check one some requests run: found, not proven. A base of the repository that comes after a class whose `dispatch` never hands on is no role guard.

A sign-in check in the body of a Python handler is read from what its test is for a request that has no caller, whichever way round it is written. `if request.user.is_authenticated: <the page>` with the refusal in the `else`, or after an `if` whose body always leaves, is the same check as `if not request.user.is_authenticated: return redirect("login")`, and reads `known` where nothing branches between the test and the refusal (an `elif` whose every test asks for the caller included). What the test is for no caller is known for the framework's `is_authenticated` and `is_anonymous`, and for a value of the caller read for its truth or compared with `None`, under any `not`, `and` and `or`; another attribute of the caller, or a helper's answer, is read as before. Three things follow from the same reading: a test that turns away the requests that *have* a caller (`if request.user.is_authenticated: return redirect("home")`, a login page) is no sign-in check, and neither is one that reads only the verb of the request (`if request.method != "POST": return redirect("login")`); and a 403 or a 404 for having no caller (`if not request.user.is_authenticated: raise PermissionDenied()`) is a sign-in check where the test reads the framework's own word for being signed in (a value kept in the session may be there for a visitor who never signed in), and no authorization check where that word is all it reads. The same holds for any refusal written this way round: `if rule.org_id == caller.org_id: return rule` followed by `raise HTTPException(status_code=404)` is the comparison a tenancy check makes, read as `if rule.org_id != caller.org_id: raise ...` is.

### Settling it

`drift practices --hints` (above) lists first the checks one `practices:` line settles, each with the units it frees and why it is not proven. A check the route reaches only sometimes stays unknown whatever is declared.

On a 3,200-file monorepo, authorization reads 19 known, 2 none and 116 unknown of 137 units, and 64 of the unknown carry a check that was found; authentication reads 150 known, 20 none and 8 unknown of 178 units. An earlier build read 74 of the authorization units known; that figure included answers that were not proven, and an independent review found about 14 of 31 sampled to be false. The 19 are what is proven, each read against the source: a count of proofs, not of how much of the repository checks authorization. This is why most routes read `unknown` for authorization. The caller's side of a comparison is partly taken from names today (`req.user.orgId`, a parameter called `session`), and a TypeScript query filtered by the session's own value is `unknown`. See [Accuracy and Limits](Accuracy-and-Limits).

See also: [How Drift Works](How-Drift-Works), [Conventions and Review](Conventions-and-Review), [Command Reference](Command-Reference#drift-practices-promote), [Security Inventory](Security-Inventory), [Setup Questions](Setup-Questions), [Using Drift with Agents](Using-Drift-with-Agents), [Output and JSON Reference](Output-and-JSON-Reference), [Glossary](Glossary).
