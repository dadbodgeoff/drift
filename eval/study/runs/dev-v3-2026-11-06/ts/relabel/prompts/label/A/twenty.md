You are labelling proposed coding conventions for the repository **twenty** (https://github.com/twentyhq/twenty at commit `a074732678d68ee75c020cf65c95b7c5f3c79207`).

A checkout of the repository at that commit is at:

    /tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-cache/repos/twenty

## Rules for this task

1. **Work only from the repository checkout.**
   - Read files, and search with grep, find or ripgrep, inside `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-cache/repos/twenty`.
   - Do not modify anything there.
   - Do not install dependencies, run builds, or access the network.
2. **Do not open anything outside `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-cache/repos/twenty`,** except for writing your output file. In particular, do not look for:
   - the tool that produced these proposals, or its source code or documentation;
   - anyone else's labels or reviews of these proposals;
   - anything on the internet.
3. **Ignore a `.drift/` directory if one exists in the checkout.** It is a cache of the tool, not part of the project.
4. **Label every proposal independently,** following the rubric below exactly.
   - Open the files the rubric requires before deciding: the example, at least three outliers, at least two other members, and the lint or compiler config when TRIVIAL is in question.
   - List every file you opened in `checked`.
5. **Write your labels to `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/lbx3/outbox/8aee04a6-043d-44ed-9500-f615d4dbaa54/out.jsonl`:**
   - one JSON object per line;
   - exactly one line for each of the 10 proposals;
   - no other text in the file.
   The directory already exists. If you stop early, the lines you wrote must still be valid.
6. **When you finish, reply with one line:** the number of proposals labelled, and the count of each label. Do not repeat the reasons.

## Rubric

### Labelling rubric v3: proposed codebase conventions

#### The setting

A tool read a repository and proposed **conventions**: rules that most code in one part of the repository follows. Each proposal shows:

- the rule, scoped to a group of code (a *role*), such as "HTTP handlers in `app/api/**`";
- its evidence: how many members of the group follow it, out of how many;
- an example member;
- the outliers: members that do not follow it.

Imagine you are a senior maintainer of this repository. The tool would let you accept a convention, so that **new** code in that part of the repository (often written by AI coding agents) is checked against it. Accepted conventions show warnings, and they can block an edit.

#### What to open before deciding

Judge from the repository, not from the rule text. Before labelling, open:

1. **the example member's file;**
2. **at least three outliers' files** (all of them if there are fewer), at the line shown;
3. **at least two other members** that follow the rule, chosen by you, not the example, in two files other than the example's and the outliers';
4. **the repository's lint and compiler config, when TRIVIAL is in question:**
   - eslint (`eslint.config.*`, `.eslintrc*`, the `eslintConfig` key of `package.json`), oxlint (`.oxlintrc.json`) or biome (`biome.json[c]`), including any config they extend from inside the repository;
   - for Python: ruff, flake8, pylint, mypy or import-linter (`ruff.toml`, `.flake8`, `.pylintrc`, `mypy.ini`, `.importlinter`, or their sections in `pyproject.toml` / `setup.cfg`);
   - `tsconfig*.json`;
   - for frameworks, what the framework requires (Nest modules, Next.js file conventions).

List every file you opened in `checked`, as repository-relative paths.

#### Decide in this order

##### Q1. Is the rule true?

- Does the example follow it?
- Do the members you sampled follow it?
- Does the rule describe the group correctly?
- Do the outliers you opened really break it?

Label **WRONG** if any of these holds:

- the rule is false for the example or for the members (`wrong_because: "misdescribes"`);
- more than half of the outliers you opened actually follow the rule, because the tool misread the code (`"false_outliers"`).

Judge the rule as the tool checks it (R9): a class decorator counts for its methods (R4), and an outlier that complies through a helper is `not_violation` (R6).

##### Q2. Would a tool already catch a violation?

**Which violation.** Imagine a new member of the group that breaks the rule **the way the outliers you opened break it**. For example, if the outliers are classes that simply don't extend `BaseController`, imagine another such class, not a subclass missing a method. If the proposal has no outliers, imagine the simplest violation: the member without the required wrapper, decorator, base class, argument or name. Outliers that are `one_off` (R1) do not count here. For argument keys, see R5; for library primitives, R7.

Label **TRIVIAL** if one of these would catch that violation, without anyone reviewing the code:

| `trivial_by` | Would be caught by | Example |
| --- | --- | --- |
| `build` | the build or bundler failing | a Next.js `page` file without a default export |
| `types` | the type checker, with the repository's tsconfig (or mypy/pyright config) | a value passed where the declared type requires the missing property |
| `framework` | the framework at startup or on first request: it refuses to run, or the member is never registered | a Nest provider missing `@Injectable()` when it has constructor dependencies; a route file not exporting a handler |
| `lint` | an **enabled** lint rule in the repository's own config, at `error`, or at `warn` when CI or a pre-commit hook fails on warnings (for example `--max-warnings 0`) | `no-restricted-imports` forbidding exactly this import; `@typescript-eslint/no-explicit-any: "error"` |
| `tautology` | the definition of the group itself: breaking it would make the member not belong to the group | "dialogs render `<Dialog>`", when "dialog" is defined by rendering one |

**Evidence.**

- Record what catches it in `trivial_evidence`: the config file and rule, or the error the framework raises.
- For `lint`, also record `lint_severity`:
  - `"error"`;
  - `"warn_enforced"`, citing the CI or hook line that fails on warnings in `trivial_evidence`.

  A `warn` rule that nothing enforces is **not** TRIVIAL. Go on to Q3.
- Each of these needs evidence you saw in the repository. "Probably linted" is not evidence: open the config.

**Check against the outliers.** The outliers are real members that break the rule. If a tool really caught the violation, they could not exist, unless the tool does not see them. So label TRIVIAL by a tool only if every outlier you opened is one of these:

- suppressed: `eslint-disable`, `@ts-expect-error`, `# noqa`, `# type: ignore`;
- outside the tool's scope: lint `overrides`, `ignorePatterns` or `exclude`, or a tsconfig that does not include the file;
- not a real violation (see Q1).

An outlier that the tool would flag, but that exists in the repo unsuppressed, is evidence that the tool does **not** catch the violation in practice. Go on to Q3.

**`use*` naming of hooks is not `framework`.** React runs a hook-calling function named `getFoo` without complaint. Only `eslint-plugin-react-hooks` (`react-hooks/rules-of-hooks`) catches a hook that calls hooks without a `use*` name. So "functions in `hooks/` are named `use*`" can be TRIVIAL only by `lint`, and only when that rule is enabled in the repo's config. Without it, go on to Q3. If the outliers are helpers that call no hooks, consider `mixed_group` there.

**Not TRIVIAL.**

- Something that is "obvious" but no tool catches is **not** TRIVIAL. Go on to Q3.
- If the repository's config turns **off** the lint rule that would enforce this (for example `no-explicit-any: "off"`), the team chose not to enforce it. Label **WRONG** with `wrong_because: "team_disabled"`, unless this part of the code clearly differs from the rest.

##### Q3. Would flagging a new violation be a useful review comment?

Picture an agent adding a new member of this group that breaks the rule, resembling the outliers you saw. The tool warns. Would a maintainer think that warning was worth it most of the time? That is, is the violation a mistake, or at least worth a second look in review?

Answer it with the count of **R2**, after setting aside one-offs (**R1**) and applying the security exception as **R3** bounds it. Whether a rule is `incidental` is decided by **R8**.

Label **ACCEPT** if yes. Typical ACCEPTs:

- an auth or permission wrapper;
- a required base class, decorator or argument;
- a layering boundary;
- a shared helper everyone is meant to use;
- a naming scheme the team chose.

For security-relevant rules (authentication, authorization, input validation), legitimate exceptions do not make the rule WRONG. A public webhook that skips the auth wrapper is still worth confirming. Label ACCEPT when the exceptions are the kind a reviewer would want to confirm. R3 says which outliers this covers: only those where the thing the rule protects is at stake.

Otherwise label **WRONG** and say why:

| `wrong_because` | Meaning |
| --- | --- |
| `mixed_group` | The group mixes unlike things, so the rule should not apply to part of it. Few is not an excuse (R1): only one-offs are set aside. Examples: co-located helpers in hook files, re-exports, base or abstract classes next to their subclasses, generated files, examples or fixtures mined as production code. |
| `legit_outliers` | The outliers are legitimately different, as a **recurring category**, and new members of that category would get false alarms. Examples: email routes that must import React, read-only endpoints without a body schema. |
| `incidental` | True, but a coincidence or a consequence of what the code does, not a choice. For example, "components call `useState`": new members that don't need state would be flagged for nothing. |

##### Clear?

Separately, say whether a developer reading only the rule's wording would know what to do: `clear: true/false`.

#### Decision rules

These rules settle points where the questions above leave room for two readings. Apply each where Q1, Q2 or Q3 points to it, and list the ones you applied in `rules` (for example `["R1", "R2"]`). They do not replace the questions: they say how to answer them.

##### R1. Outliers that are a different kind of thing: set aside only one-offs

Often some outliers are not the kind of thing the rule is about: a helper function in a directory of handlers, an error class in a service file, a field class next to forms, a config object next to generated icons, the infrastructure module of a router directory. The rule is told to agents **as worded, for its whole scope**, so an agent who writes another of these is told something wrong, and is warned for it.

- **Set aside, as `one_off`,** only an outlier that cannot recur by construction:
  - **the definition** of the rule's own wrapper, decorator, base class, component or callee (the function `withAuth` cannot be wrapped in `withAuth`; the `Footer` component does not render `<Footer>`);
  - **the one aggregator** of the scope: the single index, registry or root router that composes the members.
- **Count every other outlier,** however few. A different kind of thing is `legit` (R2). It makes the rule WRONG `mixed_group` when it decides the count in R2; it is not excused for being only one or two of many members.
- A sibling in the definition's file (another export of the module that defines the wrapper) is not the definition. Count it.

**Worked example.** acme-ledger: "functions in `src/jobs/**` are wrapped in `defineJob()`", 61/64. Outliers: `src/jobs/define-job.ts#defineJob` (the definition: `one_off`), `src/jobs/index.ts#registerAll` (the one registry: `one_off`), and `src/jobs/util/retry.ts#backoff` (a helper: `legit`). One counted outlier, `legit`, so by R2 the label is WRONG `mixed_group`: an agent adding `src/jobs/util/jitter.ts` would be told to wrap it. Had the third outlier been `src/jobs/nightly-close.ts#closeBooks`, a job with no wrapper (`mistake`), the label would be ACCEPT.

##### R2. Count the verdicts; open three more when they disagree

Q3 asks whether the warning would be worth it **most of the time**, on violations **resembling the outliers you saw**. Make that a count:

1. Give every outlier you opened a verdict: `mistake`, `look` (worth a second look), `legit`, `not_violation` (it follows the rule, Q1 and R6) or `one_off` (R1).
2. **Sampling.** Open at least three outliers. If the counted verdicts among them (not `one_off`) are not all on one side, `mistake`/`look` versus `legit`, and more outliers are listed, open three more (or all, if fewer remain).
3. **The count.** Leave out `one_off` and `not_violation`. Label **ACCEPT** only if **more than half** of the counted outliers are `mistake` or `look`, and a new member breaking the rule in the simplest way would be worth flagging. A tie is not "most": it is not ACCEPT.
4. **Otherwise WRONG,** with the reason that fits the `legit` outliers: `mixed_group` (another kind of thing, R1), `legit_outliers` (the same kind, legitimately exempt, as a recurring category), or `incidental` (they lack what makes the members follow it, R8).
5. **No counted outliers** (none listed, or all `one_off`): judge the simplest violation, at Q2 and then Q3.

What you imagine an agent *might* get wrong in future does not outweigh what the outliers show. It decides only when nothing is left to count.

**Worked example.** acme-crm: "classes in `crm/forms/**` extend `CrmForm`" (`CrmForm` adds the CSRF token), 40/44. Outliers: `crm/forms/widgets.py#DateWidget`, `crm/forms/widgets.py#MoneyWidget` (widgets, not forms: `legit`), `crm/forms/legacy.py#ImportForm` (a form on bare `forms.Form`: `mistake`). The counted verdicts disagree, and only one outlier is left to open: `crm/forms/fields.py#PhoneField` (`legit`). 1 of 4 is a mistake, so the label is WRONG `mixed_group`. The CSRF exception of R3 does not cover widgets and fields: they post nothing.

##### R3. The security exception covers only outliers where something is at stake

Q3's security exception: for authentication, authorization, input validation and CSRF rules, legitimate exceptions of the kind a reviewer would want to confirm do not make the rule WRONG. In R2, count such an outlier as `look`, not `legit`, **only if** the thing the rule protects is there:

- an endpoint or action that can be reached, and skips the auth or permission wrapper;
- a form or handler that accepts data, and skips CSRF or validation;
- an input that is read, and is not validated.

An outlier with nothing to protect is `legit`: a route that takes no input at all, under "validate their input"; a field class, under a CSRF base-class rule; a type-only module. Confirming it tells the reviewer nothing.

**Worked example.** acme-desk: "rpc procedures in `server/**` validate their input with a schema", 180/190. The outliers opened, `listMyTickets`, `getMyProfile` and `countUnread`, take no input and read only the session: `legit`, not `look`. Three more: `exportAll`, `whoAmI` (no input, `legit`) and `updateNote` (reads `input.text`, no schema: `mistake`). 1 of 6, so WRONG `legit_outliers`.

##### R4. A decorator on the class counts for its methods

"Handlers in `*.controller` files are decorated with `D`" is **true** of a handler whose class carries `D`, when the framework applies a class decorator to every handler of the class (Nest `@UseGuards`, `@ApiTags`, a resolver-scope decorator, and the like). It is not `misdescribes` because `D` sits on the class.

- If `D` never appears on a method, the wording points agents at the wrong place: say so with `clear: false`.
- Then go on to Q2 and Q3 as for the class-level rule: the outliers are handlers whose class lacks `D`.
- A proposal that restates another shown proposal (the same decorator, for the classes and for their methods) is labelled on its own merits, like every proposal. Being a duplicate is not a reason for any label. Note it in `reason` if you like.

**Worked example.** acme-fleet: "HTTP handlers in `src/**` (`*.controller` files) are decorated with `RequireTenant()`", 140/146. `@RequireTenant()` sits above `class VehiclesController`, never on a method. True as checked; `clear: false`. The six outliers are the handlers of `HealthController` and `WebhooksController`, which are public by design. Security rule, something at stake: `look` (R3). ACCEPT.

##### R5. A required argument key: the type checker catches the missing key, not the missing call

For "members pass `K` to `f()`", the violation the rule names is **a call of `f` without `K`**.

- **If `f`'s declared signature requires `K`** (not optional, no default, no `any`, `**kwargs` or untyped escape), that violation is caught:
  - TypeScript: `trivial_by: "types"`, citing the signature;
  - Python: `"types"` only if a type checker configured in the repository runs on these files; `"framework"` if the call runs at import time (a module or class body), so the app fails to start; otherwise not caught.
- **An outlier that does not call `f` at all** shows another violation: "does not use `f`". No type checker catches that. Judge it by R1 and R2: a definition or aggregator is `one_off`; a different kind of thing is `legit`; a member that should have used `f` is a `mistake`.
- So: with no counted outliers left, label **TRIVIAL** by the type (Q2, simplest violation). With counted outliers, the type does not decide: go on to Q3 with them.
- Outliers that call `f` without `K` and compile unsuppressed show that the type does not require `K` (Q2's check against the outliers).

**Worked example.** acme-ops: "functions in `src/alerts/channels/**` pass `schema` to `defineChannel()`", 30/32, where `defineChannel(opts: { schema: ZodSchema; ... })` requires `schema`. Outliers: `define-channel.ts#defineChannel` (definition) and `channels/index.ts#allChannels` (the registry): both `one_off`. Nothing is left to count, and a channel calling `defineChannel({ name })` fails `tsc`: TRIVIAL `types`. In a sibling directory the same rule's only outlier is `channels/constants.ts#DEFAULT_TIMEOUT`, a constant that never calls `defineChannel`: `legit` (R1), 0 of 1, so WRONG `mixed_group`, not TRIVIAL.

##### R6. Doing it through a helper is not a violation

An outlier that does what the rule asks **through a helper of the repository that itself does it** is `not_violation`. Examples: it calls a factory that returns the wrapped value; it renders a child component that renders the required component; it gets the value from a helper that passes the key; it calls the hook through another hook that calls it. The tool missed the indirection.

- Open the helper and check that it really does what the rule asks.
- When more than half of the outliers you opened are `not_violation`, label WRONG `false_outliers` (Q1).

**Worked example.** acme-shop: "pages in `pages/**` render `<ShopLayout>`", 50/53. `pages/sale.tsx` renders `<SaleIndex>`, which renders `<ShopLayout>`; `pages/gift.tsx` loads `ShopLayout` through `next/dynamic` and renders it; `pages/embed.tsx` renders a bare `<div>` (`legit`: embedded in third-party sites). 2 of 3 are `not_violation`: WRONG `false_outliers`.

##### R7. Library primitives: "every member has it" is not TRIVIAL

For rules that members render or call a library's primitive (an email library's `<Text>`, `<Container>`, `<Preview>`; a styling wrapper; a UI kit's `<Button>`):

- **Not TRIVIAL** because it is obvious, because every member has it, or because a missing one is visible when you run or preview the code. Only the tools of Q2 count, and a library that renders fine without the primitive does not catch it.
- **Incidental**, when the members use it because of what they contain and the outliers lack it because they lack that content: a fragment with no body copy, under "render `<Text>`"; an image-only component.
- **A choice**, when the outliers do the same job another way: a raw `<p>` instead of the email-safe `<Text>`, inline styles instead of the styling wrapper, a hand-built layout instead of `<Container>`. Then the R2 verdicts decide: a deliberate, recurring variant (a family of plain-text emails) is `legit`; drift from the house style is a `mistake`.
- **With no counted outliers,** it is a choice if a new member could realistically do the same job without the primitive (an agent writing raw HTML into an email). Judge that violation at Q3.

**Worked example.** acme-mail: "components in `emails/src/**` render `<Preheader>`", 88/90, where `<Preheader>` is the library's inbox-preview line and the library renders an email without it. Outliers: `emails/src/parts/signature.tsx#Signature` and `emails/src/parts/badge.tsx#Badge`, shared fragments that are not emails: `legit` (R1). 0 of 2: WRONG `mixed_group`. An agent writing a new fragment in `parts/` would be told to add a preheader to it.

##### R8. Incidental, or a choice?

`incidental` means the members follow the rule because of what they do, so new members that do not do it would be flagged for nothing. Decide it from the outliers:

- **Incidental:** the outliers break the rule because they lack the need: no state, no input, no context to read, no fields of their own, no body copy. Also incidental: an order or co-occurrence with no effect, where swapping or dropping it changes nothing at runtime, for the type checker, or for a caller (the order of two class attributes, an order forced by early returns).
- **A choice:** the outliers could follow the rule as easily as the members, and simply do not: an unannotated return type in a package that annotates them, an `any` where a real type fits, a name off the scheme. Not incidental. Give those outliers `mistake` or `look`, unless they share a reason to differ (then `legit`, and R2 decides).
- "A mild style nit" is not a reason for WRONG on its own. Only the reasons in the table are.

**Worked example.** acme-geo: "functions in `src/tiles/**` declare their return type", 70/74, nothing enforces it. The outliers `tileKey`, `parseZoom` and `bboxOf` are ordinary exported functions like the members, with inferred returns: they lack no need, so it is a choice, three `look`s: ACCEPT. Contrast "classes in `src/tiles/**` call `super().__init__()`", where every outlier is a class with no `__init__` of its own: they lack the need, so WRONG `incidental`.

##### R9. True as checked, but worded loosely: `clear: false`, not `misdescribes`

Q1 judges the rule **as the tool checks it**:

- an "or" list (`wrapped in A() or B() or C()`) is met by any alternative in it;
- a scope is the glob and the file pattern shown;
- a class decorator counts for its methods (R4).

If the rule is true as checked but its wording could mislead a reader (an alternative in the list that is not like the others, a name that suggests the wrong place), set `clear: false` and go on. `misdescribes` is for a rule that is false for the example or for the members you sampled, as checked. An alternative that does not serve the rule's purpose (a database-session dependency listed among auth wrappers) is judged at Q3: does the warning still catch what matters?

**Worked example.** acme-hub: "HTTP handlers in `api/**` depend on `require_user()` or `require_admin()` or `get_session()`", 90/96. `get_session()` opens a database session; it is not auth. As checked, the members follow the list, so the rule is true: `clear: false`. Q3: the six outliers are public endpoints that take no auth dependency at all (`look`, R3), so ACCEPT.

#### Output

One JSON object per proposal, one per line (JSONL). Field order does not matter. The examples below are made up: the repository `acme-shop` does not exist.

```json
{"uid": "acme-shop/D-0a1b2c", "rubric": "v3",
 "label": "ACCEPT", "trivial_by": null, "trivial_evidence": null, "lint_severity": null, "wrong_because": null,
 "clear": true, "confidence": "high",
 "checked": ["api/orders/list.ts", "api/orders/refund.ts", "api/health.ts", "api/orders/create.ts", "api/carts/get.ts", "lib/auth.ts"],
 "outliers": [{"symbol": "refund", "verdict": "mistake"}, {"symbol": "health", "verdict": "look"}], "rules": ["R2", "R3"],
 "reason": "Order handlers call requireShopUser() first (list.ts, create.ts); refund.ts skips it and reads another shop's order, while health.ts is a public probe, an exception worth confirming (R3).",
 "defects": ["api/orders/refund.ts:12 refund handler has no requireShopUser() check"]}
{"uid": "acme-shop/D-3d4e5f", "rubric": "v3",
 "label": "TRIVIAL", "trivial_by": "lint", "trivial_evidence": "eslint.config.js: no-restricted-imports error for 'lodash' (use lodash-es); the one outlier has an eslint-disable-next-line", "lint_severity": "error", "wrong_because": null,
 "clear": true, "confidence": "high",
 "checked": ["eslint.config.js", "web/cart.tsx", "web/legacy/export.ts", "web/search.tsx", "web/checkout.tsx"],
 "reason": "The import ban is already an error in eslint.config.js; the outlier in legacy/export.ts suppresses it explicitly."}
{"uid": "acme-shop/D-6a7b8c", "rubric": "v3",
 "label": "WRONG", "trivial_by": null, "trivial_evidence": null, "lint_severity": null, "wrong_because": "incidental",
 "clear": true, "confidence": "low",
 "checked": ["web/cart.tsx", "web/footer.tsx", "web/badge.tsx", "web/logo.tsx", "web/search.tsx", "web/checkout.tsx"],
 "outliers": [{"symbol": "Footer", "verdict": "legit"}, {"symbol": "Badge", "verdict": "legit"}, {"symbol": "Logo", "verdict": "legit"}], "rules": ["R2", "R8"],
 "reason": "Components call useState because most of them hold state (cart.tsx); the outliers are stateless (footer.tsx, badge.tsx), so new stateless components would be flagged for nothing. Hesitated with ACCEPT."}
```

Write only the fields below.

| Field | Required | Values |
| --- | --- | --- |
| `uid` | yes | as given in the proposal header |
| `rubric` | yes | `"v3"` |
| `label` | yes | `ACCEPT`, `TRIVIAL` or `WRONG` |
| `trivial_by` | if TRIVIAL | `build`, `types`, `framework`, `lint` or `tautology` |
| `trivial_evidence` | if TRIVIAL by a tool | the config file and rule, or the error; for `warn_enforced`, also the CI or hook line |
| `lint_severity` | if TRIVIAL by `lint` | `error` or `warn_enforced` |
| `wrong_because` | if WRONG | `misdescribes`, `false_outliers`, `mixed_group`, `legit_outliers`, `incidental` or `team_disabled` |
| `clear` | yes | `true` or `false` |
| `confidence` | yes | `high`, or `low` when you hesitated between two labels (name both in `reason`) |
| `checked` | yes | the repo-relative files you opened: <ul><li>the example's file;</li><li>at least 3 outliers' files (all if fewer);</li><li>at least 2 further files with other members;</li><li>configs.</li></ul> `collect.mjs` rejects a list that misses these. |
| `outliers` | recommended | one entry per outlier opened, with `verdict`: <ul><li>`mistake`</li><li>`look` (worth a second look)</li><li>`legit` (legitimately different)</li><li>`not_violation` (it actually follows the rule, R6)</li><li>`one_off` (the definition or the one aggregator, R1)</li></ul> |
| `rules` | recommended | the decision rules you applied, for example `["R1", "R2"]` |
| `reason` | yes | one or two sentences citing what you saw in specific files |
| `defects` | optional | outliers that look like real bugs in the project, with file:line |

Decide each proposal on its own merits. There is no expected distribution of labels.

## The proposals (10)

Each proposal starts with its `uid`. Copy it exactly into your output.

### uid: twenty/D-70d216

```text
[D-70d216] packages/twenty-server: graphql entry points in src/** (*.resolver files) are decorated with UseFilters()
    evidence: 686/712 (lower bound 0.95, lift 14.6)
    example:  packages/twenty-server/src/engine/core-modules/admin-panel/admin-panel-ai-provider.resolver.ts#MUTATION AdminPanelAiProviderResolver.addAiProvider
    outlier:  packages/twenty-server/src/engine/core-modules/admin-panel/admin-panel-application-registration.resolver.ts:67 FIELD AdminPanelApplicationRegistrationResolver.author
    outlier:  packages/twenty-server/src/engine/core-modules/admin-panel/admin-panel-application-registration.resolver.ts:37 FIELD AdminPanelApplicationRegistrationResolver.configurationIssues
    outlier:  packages/twenty-server/src/engine/core-modules/admin-panel/admin-panel-application-registration.resolver.ts:81 FIELD AdminPanelApplicationRegistrationResolver.galleryImagesUrls
    outlier:  packages/twenty-server/src/engine/core-modules/admin-panel/admin-panel-application-registration.resolver.ts:50 FIELD AdminPanelApplicationRegistrationResolver.installCount
    outlier:  packages/twenty-server/src/engine/core-modules/admin-panel/admin-panel-application-registration.resolver.ts:17 FIELD AdminPanelApplicationRegistrationResolver.isConfigured
    outlier:  packages/twenty-server/src/engine/core-modules/admin-panel/admin-panel-application-registration.resolver.ts:72 FIELD AdminPanelApplicationRegistrationResolver.logoUrl
    outlier:  packages/twenty-server/src/engine/core-modules/application/application-registration/application-registration-summary.resolver.ts:14 FIELD ApplicationRegistrationSummaryResolver.logoUrl
    outlier:  packages/twenty-server/src/engine/core-modules/geo-map/resolver/geo-map.resolver.ts:45 QUERY GeoMapResolver.getAddressDetails
    outlier:  packages/twenty-server/src/engine/core-modules/geo-map/resolver/geo-map.resolver.ts:30 QUERY GeoMapResolver.getAutoCompleteAddress
    outlier:  packages/twenty-server/src/engine/core-modules/tool-provider/resolvers/tool-index.resolver.ts:70 QUERY ToolIndexResolver.getToolIndex
    outlier:  packages/twenty-server/src/engine/core-modules/tool-provider/resolvers/tool-index.resolver.ts:89 QUERY ToolIndexResolver.getToolInputSchema
    outlier:  packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution/resolvers/agent-message-part.resolver.ts:15 FIELD AgentMessagePartResolver.createdAt
    outlier:  packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution/resolvers/agent-message-part.resolver.ts:36 FIELD AgentMessagePartResolver.fileMediaType
    outlier:  packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution/resolvers/agent-message-part.resolver.ts:20 FIELD AgentMessagePartResolver.fileUrl
    outlier:  packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution/resolvers/agent-message.resolver.ts:8 FIELD AgentMessageResolver.createdAt
    outlier:  packages/twenty-server/src/engine/metadata-modules/ai/ai-agent-execution/resolvers/agent-message.resolver.ts:13 FIELD AgentMessageResolver.processedAt
    outlier:  packages/twenty-server/src/engine/metadata-modules/ai/ai-chat/resolvers/agent-chat-subscription.resolver.ts:67 SUBSCRIPTION AgentChatSubscriptionResolver.onAgentChatEvent
    outlier:  packages/twenty-server/src/engine/metadata-modules/ai/ai-workspace-stats/resolvers/ai-workspace-stats.resolver.ts:36 QUERY AiWorkspaceStatsResolver.findWorkspaceAiStats
    outlier:  packages/twenty-server/src/engine/metadata-modules/metadata-translation/metadata-translation.resolver.ts:36 QUERY MetadataTranslationResolver.metadataTranslations
    outlier:  packages/twenty-server/src/engine/metadata-modules/minimal-metadata/minimal-metadata.resolver.ts:36 QUERY MinimalMetadataResolver.minimalMetadata
    outlier:  packages/twenty-server/src/engine/permissions/record-permissions/record-permissions.resolver.ts:48 QUERY RecordPermissionsResolver.recordPermissions
    outlier:  packages/twenty-server/src/engine/permissions/record-share/resolvers/record-sharing.resolver.ts:81 MUTATION RecordSharingResolver.removeRecordShare
    outlier:  packages/twenty-server/src/engine/permissions/record-share/resolvers/record-sharing.resolver.ts:50 MUTATION RecordSharingResolver.setRecordPrivate
    outlier:  packages/twenty-server/src/engine/permissions/record-share/resolvers/record-sharing.resolver.ts:64 MUTATION RecordSharingResolver.setRecordShare
    outlier:  packages/twenty-server/src/engine/permissions/record-share/resolvers/record-sharing.resolver.ts:42 QUERY RecordSharingResolver.recordSharing
    outlier:  packages/twenty-server/src/modules/call-recording/resolvers/call-recording.resolver.ts:31 QUERY CallRecordingResolver.callRecordingIdForCalendarEvent
```

### uid: twenty/D-5cb05f

```text
[D-5cb05f] packages/twenty-server: classes in src/database/commands/upgrade-version-command/** (*.command files) call WorkspaceCacheService.getOrRecompute()
    evidence: 240/295 (lower bound 0.77, lift 10.3)
    example:  packages/twenty-server/src/database/commands/upgrade-version-command/1-21/1-21-workspace-command-1775500001000-add-compose-email-command-menu-item.command.ts#AddComposeEmailCommandMenuItemCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/1-21/1-21-workspace-command-1775500002000-add-global-key-value-pair-unique-index.command.ts:18 AddGlobalKeyValuePairUniqueIndexCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/1-21/1-21-workspace-command-1775500003000-backfill-datasource-to-workspace.command.ts:21 BackfillDatasourceToWorkspaceCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/1-21/1-21-workspace-command-1775500009000-update-edit-layout-command-menu-item-label.command.ts:19 UpdateEditLayoutCommandMenuItemLabelCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/1-21/1-21-workspace-command-1775500010000-drop-workspace-messaging-fks.command.ts:32 DropWorkspaceMessagingFksCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/1-21/1-21-workspace-command-1775500011000-migrate-message-folder-parent-id-to-external-id.command.ts:21 MigrateMessageFolderParentIdToExternalIdCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/1-21/1-21-workspace-command-1775500012000-migrate-messaging-infrastructure-to-metadata.command.ts:44 MigrateMessagingInfrastructureToMetadataCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-19/2-19-workspace-command-1782853718000-backfill-workspace-custom-application-registration.command.ts:21 BackfillWorkspaceCustomApplicationRegistrationCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-20/2-20-workspace-command-1783526282685-backfill-workflow-version-to-core.command.ts:19 BackfillWorkflowVersionToCoreCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-22/2-22-workspace-command-1784193207000-backfill-workflow-version-core-links.command.ts:27 BackfillWorkflowVersionCoreLinksCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-23/2-23-workspace-command-1784286707000-backfill-workflow-core-links.command.ts:26 BackfillWorkflowCoreLinksCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-23/2-23-workspace-command-1784565137000-upgrade-people-data-labs-application.command.ts:31 UpgradePeopleDataLabsApplicationCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-28/2-28-workspace-command-1785600000000-repair-orphan-core-workflow-versions.command.ts:27 RepairOrphanCoreWorkflowVersionsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-33/2-33-workspace-command-1787138325228-mark-search-vector-fields-system.command.ts:17 MarkSearchVectorFieldsSystemCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-34/2-34-workspace-command-1787461587487-repair-activity-targets-junction-target.command.ts:54 RepairActivityTargetsJunctionTargetCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-36/2-36-workspace-command-1787748136001-backfill-workflow-run-core-ids.command.ts:15 BackfillWorkflowRunCoreIdsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-37/2-37-workspace-command-1787832413051-backfill-message-calendar-targets.command.ts:26 BackfillMessageCalendarTargetsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-38/2-38-workspace-command-1787918663365-configure-timeline-activity-happens-at.command.ts:19 ConfigureTimelineActivityHappensAtCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-38/2-38-workspace-command-1787935130000-normalize-company-domain-names.command.ts:31 NormalizeCompanyDomainNamesCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-38/2-38-workspace-command-1788197000000-enable-standard-activity-target-fields.command.ts:27 EnableStandardActivityTargetFieldsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-39/2-39-workspace-command-1788338950836-convert-logic-functions-to-prebuilt.command.ts:40 ConvertLogicFunctionsToPrebuiltCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-39/2-39-workspace-command-1788616958245-mark-platform-owned-standard-objects-system.command.ts:36 MarkPlatformOwnedStandardObjectsSystemCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-4/2-4-workspace-command-1797000001000-migrate-to-billing-v2.command.ts:16 MigrateToBillingV2Command
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-40/2-40-workspace-command-1788960408162-backfill-core-workflow-id-on-workflow-versions.command.ts:20 BackfillCoreWorkflowIdOnWorkflowVersionsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-41/2-41-workspace-command-1789331219041-correct-standard-field-acronym-casing.command.ts:58 CorrectStandardFieldAcronymCasingCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-41/2-41-workspace-command-1789350000002-backfill-workspace-workflow-id-on-workflows.command.ts:17 BackfillWorkspaceWorkflowIdOnWorkflowsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-41/2-41-workspace-command-1789370101009-backfill-core-version-pointers.command.ts:18 BackfillCoreVersionPointersCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-41/2-41-workspace-command-1789373200001-make-standard-child-objects-inherited.command.ts:71 MakeStandardChildObjectsInheritedCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-41/2-41-workspace-command-1789373200002-make-notes-and-tasks-inherit-their-targets.command.ts:53 MakeNotesAndTasksInheritTheirTargetsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-42/2-42-workspace-command-1789645879295-relink-workflow-versions-to-core-workflows.command.ts:17 RelinkWorkflowVersionsToCoreWorkflowsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-42/2-42-workspace-command-1789652804001-backfill-workspace-workflow-version-id.command.ts:17 BackfillWorkspaceWorkflowVersionIdCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-42/2-42-workspace-command-1789719131001-backfill-workflow-execution-core-ids.command.ts:18 BackfillWorkflowExecutionCoreIdsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-42/2-42-workspace-command-1789719131002-make-workflow-run-projection-relations-nullable.command.ts:17 MakeWorkflowRunProjectionRelationsNullableCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-42/2-42-workspace-command-1789914239896-migrate-agent-history-to-workspace.command.ts:29 MigrateAgentHistoryToWorkspaceCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-42/2-42-workspace-command-1790155020340-delete-orphan-core-workflows.command.ts:19 DeleteOrphanCoreWorkflowsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-43/2-43-workspace-command-1790171503075-attribute-chat-message-senders.command.ts:17 AttributeChatMessageSendersCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-43/2-43-workspace-command-1790266078808-relabel-attachment-target-fields.command.ts:67 RelabelAttachmentTargetFieldsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-43/2-43-workspace-command-1790339692474-repair-initial-company-targets.command.ts:19 RepairInitialCompanyTargetsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-43/2-43-workspace-command-1790352791059-backfill-oauth-only-application-source-type.command.ts:22 BackfillOAuthOnlyApplicationSourceTypeCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-44/2-44-workspace-command-1790590808102-verify-common-record-sharing.command.ts:18 VerifyCommonRecordSharingCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-44/2-44-workspace-command-1790672076234-open-agent-chat-thread-archived-at-writability.command.ts:19 OpenAgentChatThreadArchivedAtWritabilityCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-46/2-46-workspace-command-1791130332894-backfill-agent-and-workflow-is-system.command.ts:71 BackfillAgentAndWorkflowIsSystemCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-46/2-46-workspace-command-1791369613345-delete-orphaned-workflow-runs.command.ts:36 DeleteOrphanedWorkflowRunsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-47/2-47-workspace-command-1791811310066-convert-workflow-email-bodies-to-email-documents.command.ts:35 ConvertWorkflowEmailBodiesToEmailDocumentsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-47/2-47-workspace-command-1791926793834-relabel-note-and-task-target-fields.command.ts:62 RelabelNoteAndTaskTargetFieldsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-48/2-48-workspace-command-1792068879353-flush-workflow-automated-trigger-maps.command.ts:15 FlushWorkflowAutomatedTriggerMapsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-51/2-51-workspace-command-1792675225627-delete-connected-accounts-outside-provider-scope.command.ts:17 DeleteConnectedAccountsOutsideProviderScopeCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-52/2-52-workspace-command-1792766943126-seed-workspace-frontend-dependencies.command.ts:17 SeedWorkspaceFrontendDependenciesCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-53/2-53-workspace-command-1793176233512-move-application-and-system-access-to-disabled-actions.command.ts:55 MoveApplicationAndSystemAccessToDisabledActionsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-53/2-53-workspace-command-1793205123864-move-application-and-system-field-writability-to-disabled-actions.command.ts:28 MoveApplicationAndSystemFieldWritabilityToDisabledActionsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-54/2-54-workspace-command-1793352708113-strip-server-routes-from-custom-app-logic-functions.command.ts:20 StripServerRoutesFromCustomAppLogicFunctionsCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-56/2-56-workspace-command-1793697418663-make-agent-turn-thread-optional.command.ts:17 MakeAgentTurnThreadOptionalCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-56/2-56-workspace-command-1793783100802-convert-workflow-navigation-menu-items-to-native-page.command.ts:64 ConvertWorkflowNavigationMenuItemsToNativePageCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-56/2-56-workspace-command-1793783100804-scope-workflow-command-menu-items-to-core-object.command.ts:20 ScopeWorkflowCommandMenuItemsToCoreObjectCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/2-9/2-9-workspace-command-1799000000000-migrate-ai-model-preferences.command.ts:37 MigrateAiModelPreferencesCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/upgrade.command.ts:31 UpgradeCommand
```

### uid: twenty/D-c39eb9

```text
[D-c39eb9] packages/twenty-server: classes in src/** (*.exception files) extend CustomException
    evidence: 126/136 (lower bound 0.87, lift 32.0)
    example:  packages/twenty-server/src/database/clickhouse/clickhouse.exception.ts#ClickHouseException
    outlier:  packages/twenty-server/src/engine/core-modules/usage-limit/exceptions/usage-limit-http.exception.ts:6 UsageLimitHttpException
    outlier:  packages/twenty-server/src/engine/guards/exceptions/auth-principal-refused.exception.ts:9 AuthPrincipalRefusedException
    outlier:  packages/twenty-server/src/engine/metadata-modules/ai/ai-front-component/exceptions/front-component-build.exception.ts:10 FrontComponentBuildException
    outlier:  packages/twenty-server/src/engine/metadata-modules/page-layout-widget/exceptions/page-layout-widget-field-validation.exception.ts:1 PageLayoutWidgetFieldValidationException
    outlier:  packages/twenty-server/src/engine/metadata-modules/validation-rule/exceptions/record-validation-rule-http.exception.ts:20 RecordValidationRuleHttpException
    outlier:  packages/twenty-server/src/engine/twenty-orm/upgrade-aware/exceptions/upgrade-unavailable-entity-write.exception.ts:1 UpgradeUnavailableEntityWriteException
    outlier:  packages/twenty-server/src/engine/workspace-datasource/exceptions/workspace-datasource.exception.ts:20 WorkspaceDataSourceException
    outlier:  packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/exceptions/workspace-migration-action-execution.exception.ts:44 WorkspaceMigrationActionExecutionException
    outlier:  packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/exceptions/workspace-migration-runner.exception.ts:83 WorkspaceMigrationRunnerException
    outlier:  packages/twenty-server/src/modules/messaging/message-import-manager/drivers/exceptions/message-import-driver.exception.ts:3 MessageImportDriverException
```

### uid: twenty/D-2df337

```text
[D-2df337] packages/twenty-server: classes in src/database/commands/** are decorated with RegisteredInstanceCommand()
    evidence: 288/289 (lower bound 0.98, lift 15.4)
    example:  packages/twenty-server/src/database/commands/upgrade-version-command/1-21/1-21-instance-command-fast-1775129420309-add-view-field-group-id-index-on-view-field.ts#AddViewFieldGroupIdIndexOnViewFieldFastInstanceCommand
    outlier:  packages/twenty-server/src/database/commands/questions/confirmation.question.ts:6 ConfirmationQuestion
```

### uid: twenty/D-0929de

```text
[D-0929de] packages/twenty-server: classes in src/** (*.dto files) are decorated with ObjectType()
    evidence: 402/406 (lower bound 0.97, lift 9.8)
    example:  packages/twenty-server/src/engine/core-modules/admin-panel/dtos/admin-chat-message-part.dto.ts#AdminChatMessagePartDTO
    outlier:  packages/twenty-server/src/engine/core-modules/application/connection-provider/connections/dtos/get-app-connection.dto.ts:3 GetAppConnectionDto
    outlier:  packages/twenty-server/src/engine/core-modules/application/connection-provider/connections/dtos/list-app-connections.dto.ts:6 ListAppConnectionsDto
    outlier:  packages/twenty-server/src/engine/core-modules/billing/app-billing/dtos/charge.dto.ts:22 ChargeDto
    outlier:  packages/twenty-server/src/engine/permissions/record-share/dtos/record-sharing.dto.ts:25 RecordSharePrincipalInput
```

### uid: twenty/D-2456fc

```text
[D-2456fc] packages/twenty-server: classes in src/database/** (*.command files) extend ProvisionedWorkspaceCommandRunner
    evidence: 295/305 (lower bound 0.94, lift 14.4)
    example:  packages/twenty-server/src/database/commands/install-pre-installed-apps.command.ts#InstallPreInstalledAppsCommand
    outlier:  packages/twenty-server/src/database/commands/cron-register-all.command.ts:47 CronRegisterAllCommand
    outlier:  packages/twenty-server/src/database/commands/data-seed-dev-workspace.command.ts:21 DataSeedWorkspaceCommand
    outlier:  packages/twenty-server/src/database/commands/generate-instance-command.command.ts:32 GenerateInstanceCommandCommand
    outlier:  packages/twenty-server/src/database/commands/list-and-delete-orphaned-workspace-entities.command.ts:117 ListOrphanedWorkspaceEntitiesCommand
    outlier:  packages/twenty-server/src/database/commands/rebuild-application-default-deps.command.ts:20 RebuildApplicationDefaultDepsCommand
    outlier:  packages/twenty-server/src/database/commands/run-instance-commands.command.ts:27 RunInstanceCommandsCommand
    outlier:  packages/twenty-server/src/database/commands/secret-encryption-rotation/rotate-secret-encryption.command.ts:20 RotateSecretEncryptionCommand
    outlier:  packages/twenty-server/src/database/commands/update-feature-flag.command.ts:28 UpdateFeatureFlagCommand
    outlier:  packages/twenty-server/src/database/commands/upgrade-version-command/upgrade.command.ts:31 UpgradeCommand
    outlier:  packages/twenty-server/src/database/commands/workspace-export/workspace-export.command.ts:17 WorkspaceExportCommand
```

### uid: twenty/D-bc65cf

```text
[D-bc65cf] packages/twenty-ui: exported values in design-tokens/color/** pass `dark` to token()
    evidence: 31/32 (lower bound 0.84, lift 222.3)
    example:  packages/twenty-ui/design-tokens/color/amber.ts#AMBER_COLOR_TOKENS
    outlier:  packages/twenty-ui/design-tokens/color/index.ts:33 COLOR_TOKENS
```

### uid: twenty/D-0cd62c

```text
[D-0cd62c] packages/twenty-server: graphql entry points in src/engine/core-modules/application/** (*.resolver files) are decorated with MetadataResolver()
    evidence: 87/88 (lower bound 0.94, lift 21.4)
    example:  packages/twenty-server/src/engine/core-modules/application/application-authorization/application-authorization.resolver.ts#MUTATION ApplicationAuthorizationResolver.revokeApplicationAuthorization
    outlier:  packages/twenty-server/src/engine/core-modules/application/application-monitoring/admin-application-monitoring.resolver.ts:42 QUERY AdminApplicationMonitoringResolver.findAdminApplicationRegistrationMonitoring
```

### uid: twenty/D-2a3e38

```text
[D-2a3e38] packages/twenty-server: HTTP handlers in src/** (*.controller files) are decorated with UseFilters()
    evidence: 140/154 (lower bound 0.85, lift 13.8)
    example:  packages/twenty-server/src/engine/api/mcp/controllers/mcp-core.controller.ts#POST /
    outlier:  packages/twenty-server/src/engine/core-modules/application/application-oauth/controllers/oauth-discovery.controller.ts:23 GET /oauth-authorization-server
    outlier:  packages/twenty-server/src/engine/core-modules/application/application-oauth/controllers/oauth-discovery.controller.ts:66 GET /oauth-protected-resource
    outlier:  packages/twenty-server/src/engine/core-modules/application/application-oauth/controllers/oauth-discovery.controller.ts:74 GET /oauth-protected-resource/mcp
    outlier:  packages/twenty-server/src/engine/core-modules/application/application-registration/application-registration-claim.controller.ts:32 GET /github/callback
    outlier:  packages/twenty-server/src/engine/core-modules/application/connection-provider/connection-provider-custom.controller.ts:42 GET /callback
    outlier:  packages/twenty-server/src/engine/core-modules/application/connection-provider/connection-provider-oauth.controller.ts:43 GET /authorize
    outlier:  packages/twenty-server/src/engine/core-modules/application/connection-provider/connection-provider-oauth.controller.ts:150 GET /callback
    outlier:  packages/twenty-server/src/engine/core-modules/billing/app-billing/app-billing.controller.ts:71 GET /credits
    outlier:  packages/twenty-server/src/engine/core-modules/billing/app-billing/app-billing.controller.ts:112 POST /charge
    outlier:  packages/twenty-server/src/engine/core-modules/client-config/client-config.controller.ts:14 GET /
    outlier:  packages/twenty-server/src/engine/core-modules/health/controllers/health.controller.ts:12 GET /
    outlier:  packages/twenty-server/src/engine/core-modules/well-known/controllers/well-known.controller.ts:37 GET /api-catalog
    outlier:  packages/twenty-server/src/engine/core-modules/well-known/controllers/well-known.controller.ts:21 GET /mcp/server-card.json
    outlier:  packages/twenty-server/src/modules/emailing/controllers/campaign-tracking.controller.ts:86 GET /o/:token
```

### uid: twenty/D-3c8584

```text
[D-3c8584] packages/twenty-server: classes in src/engine/workspace-manager/workspace-migration/workspace-migration-runner/** (*.service files) extend WorkspaceMigrationRunnerActionHandler()
    evidence: 126/136 (lower bound 0.87, lift 32.7)
    example:  packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/action-handlers/agent-chat-channel-role/services/create-agent-chat-channel-role-action-handler.service.ts#CreateAgentChatChannelRoleActionHandlerService
    outlier:  packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/deferred-action-handlers/services/build-index-deferred-action-handler.service.ts:17 BuildIndexDeferredActionHandlerService
    outlier:  packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/deferred-action-handlers/services/delete-logic-function-resources-deferred-action-handler.service.ts:24 DeleteLogicFunctionResourcesDeferredActionHandlerService
    outlier:  packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/deferred-action-handlers/services/validate-foreign-key-deferred-action-handler.service.ts:17 ValidateForeignKeyDeferredActionHandlerService
    outlier:  packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/registry/deferred-workspace-migration-action-handler-registry.service.ts:16 DeferredWorkspaceMigrationActionHandlerRegistryService
    outlier:  packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/registry/workspace-migration-runner-action-handler-registry.service.ts:20 WorkspaceMigrationRunnerActionHandlerRegistryService
    outlier:  packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/services/deferred-workspace-migration-action-gauge.service.ts:17 DeferredWorkspaceMigrationActionGaugeService
    outlier:  packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/services/deferred-workspace-migration-action-recovery.service.ts:15 DeferredWorkspaceMigrationActionRecoveryService
    outlier:  packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/services/deferred-workspace-migration-action-runner.service.ts:37 DeferredWorkspaceMigrationActionRunnerService
    outlier:  packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/services/in-flight-deferred-workspace-migration-actions.service.ts:15 InFlightDeferredWorkspaceMigrationActionsService
    outlier:  packages/twenty-server/src/engine/workspace-manager/workspace-migration/workspace-migration-runner/services/workspace-migration-runner.service.ts:41 WorkspaceMigrationRunnerService
```
