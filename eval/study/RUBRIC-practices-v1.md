# Labelling rubric: practice assignments

This is the rubric for M-acc and M-apart (PLAN-R13 §5; pre-registration `PREREG-R13-practices.md`). A labeller judges one sampled **(unit, assigned variant)** pair at a time against the code, and checks each "what sets it apart" attribute shown for the variant. The sample is drawn by `practices.mjs sample`, the cards are rendered by `lib.mjs labellerCard` (practice items), and the prompt by `prompt.mjs label` from `PRACTICE-PROMPT.md`.

The rubric id is `practices` (lib.mjs `RUBRICS`); the labeller-facing text names no version, because the leak check refuses one. A change to this file after the pre-registration is a new rubric: give it a new id and file.

**What labellers see.** `prompt.mjs` gives labellers this file from "## The setting" on, without the study-only blocks. The card shows the concern, the unit, the assigned variant's label, mechanisms and instruments, and the attributes to check. It never shows the variant's share, its member counts, which variant is dominant, or the counts behind "what sets it apart".

<!-- study-only -->
Scoring (practices.mjs score): accuracy = CORRECT / all sampled units, per concern; UNSURE, NOT_IN_POPULATION, an unresolved A/B disagreement and a missing label all count against it [STRICT]. FALSE_NONE rate = FALSE_NONE / sampled units assigned none, per concern. M-apart = TRUE / all attribute verdicts.
<!-- /study-only -->

## The setting

A tool read a repository and described, for several **cross-cutting concerns** (authentication, error handling, logging, ...), how the code handles each one. For each concern it picked a **population** of code units (for example, the production HTTP handlers), and put each unit into one **variant**: a way of handling the concern, such as "wrapped in `withWorkspace()`" or "raises `HTTPException`". A variant can also be a recorded absence, `none`: "no guard, nothing opens it", "no logging". When the tool could not tell, the unit is `unknown`.

You are shown one unit at a time, with the variant the tool assigned. Decide whether the assignment is right, by reading the code.

## The concerns

The concern and its population are part of the card. What counts as "doing the concern":

- **authn** (Authentication), population: production entry points (HTTP handlers, server actions, GraphQL and RPC resolvers, jobs). Doing it: the unit establishes or requires who the caller is before acting: an auth wrapper or decorator, a guard dependency (FastAPI `Depends(get_current_user)`, Nest `@UseGuards`), middleware that provably covers the route, an in-body check that rejects an unauthenticated caller, or an explicit public marker ("explicitly public" is a variant). A dependency that does not authenticate (a database session) is not authentication.
- **authz** (Authorization and tenant scoping), population: entry points that authenticate. Doing it: a role or permission check (a privileged wrapper, an in-body check on a role or permission, a policy-library call) and/or a tenant scope (an organisation, workspace or team id from a header, a session claim or a path parameter), enforced by a check or by a scoped query.
- **errors** (Error handling), population: entry points (how errors become responses) or exported services (what they throw and how they catch). Doing it: a wrapper that maps errors to responses, an app-level handler that covers the thrown class, a try/catch that responds, a framework HTTP error thrown, or none of these (the framework default, `bubble`, is a fact, not a gap).
- **logging** (Logging and observability), population: functions with a log-call candidate, catch clauses, or entry points. Doing it: calls to a real logger (console, print, a library logger, the repository's own logger module), structured or message style; for catch clauses, logging or reporting the error; for entry points, logging or tracing at all. A method named like a level on something that is not a logger (`map.info`) is not logging.
- **api** (API design and responses), population: HTTP entry points. Doing it: the response builder used, a declared response model, and the error envelope (the keys of error bodies).
- **validation** (Input validation), population: entry points that read request input. Doing it: a schema at the boundary (zod, pydantic, class-validator DTOs, tRPC `.input`), typed model parameters that the framework validates, manual checks that reject bad input with 400/422, or none.
- **config** (Config, secrets, feature flags), population: functions that read environment variables or configuration. Doing it: reading `process.env` / `os.environ` in place, or through a config module or a library settings schema; for flags, a flag SDK or an ad-hoc environment boolean.
- **data_access** (Data access), population: production functions that call a database client or run SQL. Doing it: the client or ORM used (Prisma, Drizzle, SQLAlchemy, the Django ORM, raw SQL, ...) and where the call sits (directly in the entry point, in a repository or service module, or in a script).
- **testing** (Testing practice), population: test files, or entry points (whether they are tested). Doing it: the runner, mocking style and fixtures of a test file; for an entry point, whether a test requests its route or calls its handler, and which status codes the tests assert.

## The card

- `concern`: the concern id and title.
- `unit`: what kind of unit it is, and where: the file, the line and the symbol.
- `assigned`: the variant's label, and whether it is a known variant, `none` (a recorded absence) or `unknown`.
- `mechanisms` and `instruments`: how the variant applies the concern and with what (`wrap: apps/web/lib/auth.ts#withWorkspace` means the handler is wrapped by `withWorkspace`, defined in `apps/web/lib/auth.ts`). A unit with several instruments (middleware plus an in-body check) has them all: that combination is the variant.
- `what sets this variant apart`: attributes the tool found to be typical of this variant's units and not of the main variant's. Each is `kind:value`:
  - `package:` the package the unit is in; `dir:` a directory it is under; `stem:` its file name without extension; `lang:` its language;
  - `role:` a group of similar code the tool formed (judge it from the path and kind, as best you can, or UNSURE);
  - `entry:` its entry kind (`http`, `server_action`, `job`, ...); `method:` its HTTP method; `route:` the first segment of its route;
  - `imports:` a module its file imports;
  - `wrap:` an instrument from another concern that the unit uses.

## What to open before deciding

1. **The unit's file,** at the line shown. Read the whole unit (the handler, function, catch clause or test file).
2. **One hop into each instrument:** open the definition of each wrapper, decorator, dependency, guard, logger, error class or client the unit uses for the concern, and check what it does. One hop is enough: you do not need to follow it further.
3. **For a route-level mechanism** (middleware, a router dependency, a route matcher), the file that applies it, to check that it covers this unit.
4. **For `none` and `unknown`,** look for the concern in the unit and one hop from it before agreeing: search the unit's file for the usual instruments of the concern.

List every file you opened in `checked`, as repository-relative paths. The unit's file must be among them.

## Labels

Decide in this order and take the first that applies.

1. **NOT_IN_POPULATION.** The unit is not what the population says: not production code (a test, a fixture, an example, a script, generated code) where the population is production code; not an entry point where it is entry points; it does not read input where the population is "entry points that read input". A unit that is in the population but handles the concern trivially is still in it.
2. For a **known variant**:
   - **CORRECT:** the unit does what the label says (with these mechanisms and instruments), and that is how it handles the concern. An extra instrument the label leaves out that also handles the concern makes it WRONG_VARIANT, not CORRECT.
   - **WRONG_VARIANT:** the unit handles the concern another way: a different instrument or mechanism, a combination the label does not describe, an instrument that does not do what the label says (a "guard" that does not check the caller), or nothing at all (it should be `none`).
3. For **`none`**:
   - **CORRECT:** the unit really does not handle the concern, in its body or one hop from it.
   - **FALSE_NONE:** the unit does handle the concern. Say how in `actual`. (Not MISSED: for `none`, always FALSE_NONE.)
4. For **`unknown`**:
   - **CORRECT:** you cannot tell from the unit and one hop either: the instrument is opaque (dynamic, generated, from outside the repository with no clear meaning), or the code does not parse as written.
   - **MISSED:** the unit does handle the concern, in a way you can read from the unit and one hop. Say how in `actual`.
   - **WRONG_VARIANT:** the unit plainly does nothing for the concern (it should be `none`).
5. **UNSURE:** you opened what the rubric asks and still cannot decide. Say why in `reason`. Use it rarely; it is not a way to skip a unit.

**Loose wording.** If the label is right in substance but worded loosely (the instrument is right, the wording is vague), it is CORRECT; name the wording problem in `reason`.

## What sets it apart

For each attribute shown, give a verdict on **this unit only**:

- **TRUE:** the unit has the attribute (its path is under that `dir:`, its file imports that module, it uses that `wrap:` instrument, ...).
- **FALSE:** it does not.
- **UNSURE:** you cannot check it from the code (most often a `role:`).

Do not judge whether the attribute *explains* the variant: only whether this unit has it.

## Output

One JSON object per unit, one per line (JSONL). Field order does not matter. The examples below are made up: the repository `acme-shop` does not exist.

```json
{"uid": "acme-shop/authn/3f9a01c2", "rubric": "practices", "label": "CORRECT", "confidence": "high",
 "checked": ["api/orders/list.ts", "lib/auth.ts"],
 "apart": [{"attribute": "dir:api/orders", "verdict": "TRUE"}],
 "reason": "list.ts exports GET = withShopUser(handler); withShopUser in lib/auth.ts reads the session and returns 401 when it is missing."}
{"uid": "acme-shop/authn/77b0d413", "rubric": "practices", "label": "FALSE_NONE", "confidence": "high",
 "checked": ["api/health/route.ts", "lib/session.ts"],
 "apart": [],
 "actual": "an in-body check: const s = await getSession(); if (!s) return 401",
 "reason": "Assigned none, but the handler calls getSession() from lib/session.ts and returns 401 without a session."}
{"uid": "acme-shop/logging/0c11e9aa", "rubric": "practices", "label": "UNSURE", "confidence": "low",
 "checked": ["jobs/sync.py", "jobs/util.py"],
 "apart": [{"attribute": "role:R-1a2b3c", "verdict": "UNSURE"}],
 "reason": "log() in util.py forwards to a callable passed in at start-up; from the code I cannot tell whether it is a logger or a progress callback."}
```

Write only the fields below.

| Field | Required | Values |
| --- | --- | --- |
| `uid` | yes | as given on the card |
| `rubric` | yes | `"practices"` |
| `label` | yes | `CORRECT`, `WRONG_VARIANT`, `MISSED`, `FALSE_NONE`, `NOT_IN_POPULATION` or `UNSURE` |
| `actual` | if WRONG_VARIANT, MISSED or FALSE_NONE | what the unit actually does for the concern, in a few words, naming the instrument |
| `apart` | yes | one entry per attribute shown on the card, `{"attribute": "<exactly as shown>", "verdict": "TRUE" \| "FALSE" \| "UNSURE"}`; `[]` when the card shows none |
| `confidence` | yes | `high`, or `low` when you hesitated between two labels (name both in `reason`) |
| `checked` | yes | the repo-relative files you opened, the unit's file first |
| `reason` | yes | one or two sentences citing what you saw in specific files |

Decide each unit on its own merits. There is no expected distribution of labels.
