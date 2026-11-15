You are labelling proposed coding conventions for the repository **infisical** (https://github.com/Infisical/infisical at commit `41db38dca9f70d69f3bab268b631c31debfc51d4`).

A checkout of the repository at that commit is at:

    /tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-cache/repos/infisical

## Rules for this task

1. **Work only from the repository checkout.**
   - Read files, and search with grep, find or ripgrep, inside `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-cache/repos/infisical`.
   - Do not modify anything there.
   - Do not install dependencies, run builds, or access the network.
2. **Do not open anything outside `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-cache/repos/infisical`,** except for writing your output file. In particular, do not look for:
   - the tool that produced these proposals, or its source code or documentation;
   - anyone else's labels or reviews of these proposals;
   - anything on the internet.
3. **Ignore a `.drift/` directory if one exists in the checkout.** It is a cache of the tool, not part of the project.
4. **Label every proposal independently,** following the rubric below exactly.
   - Open the files the rubric requires before deciding: the example, at least three outliers, at least two other members, and the lint or compiler config when TRIVIAL is in question.
   - List every file you opened in `checked`.
5. **Write your labels to `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/lbx3/outbox/f1c29167-1870-46d9-b8ce-a66d39603d3e/out.jsonl`:**
   - one JSON object per line;
   - exactly one line for each of the 13 proposals;
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

## The proposals (13)

Each proposal starts with its `uid`. Copy it exactly into your output.

### uid: infisical/D-055c32

```text
[D-055c32] backend: components in src/** render inside <BaseEmailWrapper>
    evidence: 53/57 (lower bound 0.83, lift 44.2)
    example:  backend/src/services/smtp/emails/AccessApprovalRequestTemplate.tsx#AccessApprovalRequestTemplate
    outlier:  backend/src/services/smtp/emails/BaseButton.tsx:9 BaseButton
    outlier:  backend/src/services/smtp/emails/BaseEmailWrapper.tsx:11 BaseEmailWrapper
    outlier:  backend/src/services/smtp/emails/BaseLink.tsx:9 BaseLink
    outlier:  backend/src/services/smtp/emails/LegacyPkiDeprecationTemplate.tsx:13 LegacyPkiDeprecationTemplate
```

### uid: infisical/D-34f463

```text
[D-34f463] backend: components in src/** render <BaseEmailWrapper>
    evidence: 54/57 (lower bound 0.86, lift 44.2)
    example:  backend/src/services/smtp/emails/AccessApprovalRequestTemplate.tsx#AccessApprovalRequestTemplate
    outlier:  backend/src/services/smtp/emails/BaseButton.tsx:9 BaseButton
    outlier:  backend/src/services/smtp/emails/BaseEmailWrapper.tsx:11 BaseEmailWrapper
    outlier:  backend/src/services/smtp/emails/BaseLink.tsx:9 BaseLink
```

### uid: infisical/D-259bd1

```text
[D-259bd1] backend: HTTP handlers in src/** are wrapped in verifyAuth() or passport.authenticate() or withOAuthTokenErrorAsBadRequest()
    evidence: 1582/1702 (lower bound 0.92, lift 5.6)
    split:    verifyAuth 1576, passport.authenticate 3, withOAuthTokenErrorAsBadRequest 3
    example:  backend/src/ee/routes/scep/pki-scep-router.ts#POST /:profileId/challenge
    outlier:  backend/src/ee/routes/est/certificate-est-router.ts:246 GET /:identifier/cacerts
    outlier:  backend/src/ee/routes/est/certificate-est-router.ts:336 GET /applications/:applicationId/profiles/:profileId/cacerts
    outlier:  backend/src/ee/routes/est/certificate-est-router.ts:170 POST /:identifier/simpleenroll
    outlier:  backend/src/ee/routes/est/certificate-est-router.ts:208 POST /:identifier/simplereenroll
    outlier:  backend/src/ee/routes/est/certificate-est-router.ts:284 POST /applications/:applicationId/profiles/:profileId/simpleenroll
    outlier:  backend/src/ee/routes/est/certificate-est-router.ts:310 POST /applications/:applicationId/profiles/:profileId/simplereenroll
    outlier:  backend/src/ee/routes/scep/pki-scep-router.ts:33 GET /:profileId/pkiclient.exe
    outlier:  backend/src/ee/routes/scep/pki-scep-router.ts:208 GET /applications/:applicationId/profiles/:profileId/pkiclient.exe
    outlier:  backend/src/ee/routes/scep/pki-scep-router.ts:88 POST /:profileId/pkiclient.exe
    outlier:  backend/src/ee/routes/scep/pki-scep-router.ts:258 POST /applications/:applicationId/profiles/:profileId/pkiclient.exe
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-session-skill-router.ts:50 GET /skills
    outlier:  backend/src/ee/routes/v1/certificate-authority-crl-router.ts:8 GET /:crlId
    outlier:  backend/src/ee/routes/v1/certificate-authority-crl-router.ts:32 GET /:crlId/der
    outlier:  backend/src/ee/routes/v1/certificate-authority-ocsp-router.ts:112 GET /:caId/*
    outlier:  backend/src/ee/routes/v1/certificate-authority-ocsp-router.ts:94 POST /:caId
    outlier:  backend/src/ee/routes/v1/honey-token-routers/honey-token-endpoints.ts:152 POST /trigger
    outlier:  backend/src/ee/routes/v1/kmip-server-router.ts:424 POST /login
    outlier:  backend/src/ee/routes/v1/ldap-router.ts:115 POST /login
    outlier:  backend/src/ee/routes/v1/oidc-router.ts:129 GET /callback
    outlier:  backend/src/ee/routes/v1/oidc-router.ts:76 GET /login
    outlier:  backend/src/ee/routes/v1/oidc-router.ts:197 GET /login/error
    outlier:  backend/src/ee/routes/v1/pam-routers/pam-session-router.ts:487 GET /:accountId/web-access
    outlier:  backend/src/ee/routes/v1/pki-acme-router.ts:488 GET /applications/:applicationId/profiles/:profileId/directory
    outlier:  backend/src/ee/routes/v1/pki-acme-router.ts:78 GET /profiles/:profileId/directory
    outlier:  backend/src/ee/routes/v1/pki-acme-router.ts:126 GET /profiles/:profileId/new-nonce
    outlier:  backend/src/ee/routes/v1/pki-acme-router.ts:100 HEAD /profiles/:profileId/new-nonce
    outlier:  backend/src/ee/routes/v1/pki-acme-router.ts:502 POST /applications/:applicationId/profiles/:profileId/new-account
    outlier:  backend/src/ee/routes/v1/pki-acme-router.ts:191 POST /profiles/:profileId/accounts/:accountId
    outlier:  backend/src/ee/routes/v1/pki-acme-router.ts:338 POST /profiles/:profileId/accounts/:accountId/orders
    outlier:  backend/src/ee/routes/v1/pki-acme-router.ts:412 POST /profiles/:profileId/authorizations/:authzId
    outlier:  backend/src/ee/routes/v1/pki-acme-router.ts:446 POST /profiles/:profileId/authorizations/:authzId/challenges/:challengeId
    outlier:  backend/src/ee/routes/v1/pki-acme-router.ts:153 POST /profiles/:profileId/new-account
    outlier:  backend/src/ee/routes/v1/pki-acme-router.ts:228 POST /profiles/:profileId/new-order
    outlier:  backend/src/ee/routes/v1/pki-acme-router.ts:264 POST /profiles/:profileId/orders/:orderId
    outlier:  backend/src/ee/routes/v1/pki-acme-router.ts:374 POST /profiles/:profileId/orders/:orderId/certificate
    outlier:  backend/src/ee/routes/v1/pki-acme-router.ts:300 POST /profiles/:profileId/orders/:orderId/finalize
    outlier:  backend/src/ee/routes/v1/relay-router.ts:173 POST /heartbeat-instance-relay
    outlier:  backend/src/ee/routes/v1/relay-router.ts:16 POST /register-instance-relay
    outlier:  backend/src/ee/routes/v1/removed-product-tombstone-router.ts:18 DELETE ?
    outlier:  backend/src/ee/routes/v1/removed-product-tombstone-router.ts:18 GET ?
    outlier:  backend/src/ee/routes/v1/removed-product-tombstone-router.ts:18 PATCH ?
    outlier:  backend/src/ee/routes/v1/removed-product-tombstone-router.ts:18 POST ?
    outlier:  backend/src/ee/routes/v1/removed-product-tombstone-router.ts:18 PUT ?
    outlier:  backend/src/ee/routes/v1/saml-router.ts:332 GET /redirect/saml2/:samlConfigId
    outlier:  backend/src/ee/routes/v1/saml-router.ts:300 GET /redirect/saml2/organizations/:orgSlug
    outlier:  backend/src/ee/routes/v1/saml-router.ts:268 GET /redirect/saml2/organizations/domain/:domain
    outlier:  backend/src/ee/routes/v1/saml-router.ts:364 POST /saml2/:samlConfigId
    outlier:  backend/src/ee/routes/v2/relay-router.ts:342 POST /login
    outlier:  backend/src/ee/routes/v3/gateway-router.ts:501 POST /login
    outlier:  backend/src/ee/routes/v3/gateway-router.ts:829 POST /token-auth/enroll
    outlier:  backend/src/server/plugins/secret-scanner-v2.ts:87 POST /bitbucket
    outlier:  backend/src/server/plugins/secret-scanner-v2.ts:61 POST /github
    outlier:  backend/src/server/plugins/secret-scanner-v2.ts:135 POST /gitlab
    outlier:  backend/src/server/plugins/secret-scanner.ts:51 POST /
    outlier:  backend/src/server/plugins/serve-ui.ts:158 GET /*
    outlier:  backend/src/server/plugins/serve-ui.ts:43 GET /runtime-ui-env.js
    outlier:  backend/src/server/routes/index.ts:5275 GET /api/status
    outlier:  backend/src/server/routes/v1/account-recovery-router.ts:78 POST /enable-email-auth
    outlier:  backend/src/server/routes/v1/account-recovery-router.ts:10 POST /send-email
    outlier:  backend/src/server/routes/v1/account-recovery-router.ts:46 POST /verify-email
    outlier:  backend/src/server/routes/v1/admin-router.ts:78 GET /config
    outlier:  backend/src/server/routes/v1/admin-router.ts:1000 POST /bootstrap
    outlier:  backend/src/server/routes/v1/admin-router.ts:832 POST /signup
    outlier:  backend/src/server/routes/v1/announcement-router.ts:90 GET /assets/:filename
    outlier:  backend/src/server/routes/v1/auth-router.ts:11 POST /logout
    outlier:  backend/src/server/routes/v1/auth-router.ts:83 POST /token
    outlier:  backend/src/server/routes/v1/certificate-authority-router.ts:176 GET /:caId/certificates/:caCertId/der
    outlier:  backend/src/server/routes/v1/certificate-authority-routers/internal-certificate-authority-router.ts:300 GET /:caId/ca-certificates
    outlier:  backend/src/server/routes/v1/certificate-authority-routers/internal-certificate-authority-router.ts:335 GET /:caId/certificate
    outlier:  backend/src/server/routes/v1/certificate-authority-routers/internal-certificate-authority-router.ts:373 GET /:caId/certificate/:certId
    outlier:  backend/src/server/routes/v1/certificate-authority-routers/internal-certificate-authority-router.ts:749 GET /:caId/certificates/:caCertId/der
    outlier:  backend/src/server/routes/v1/delegated-approval-callback-router.ts:13 POST /callback
    outlier:  backend/src/server/routes/v1/github-app-router.ts:58 GET /manifest/callback
    outlier:  backend/src/server/routes/v1/identity-access-token-router.ts:8 POST /token/renew
    outlier:  backend/src/server/routes/v1/identity-access-token-router.ts:45 POST /token/revoke
    outlier:  backend/src/server/routes/v1/identity-alicloud-auth-router.ts:20 POST /alicloud-auth/login
    outlier:  backend/src/server/routes/v1/identity-aws-iam-auth-router.ts:24 POST /aws-auth/login
    outlier:  backend/src/server/routes/v1/identity-azure-auth-router.ts:19 POST /azure-auth/login
    outlier:  backend/src/server/routes/v1/identity-gcp-auth-router.ts:19 POST /gcp-auth/login
    outlier:  backend/src/server/routes/v1/identity-jwt-auth-router.ts:95 POST /jwt-auth/login
    outlier:  backend/src/server/routes/v1/identity-kubernetes-auth-router.ts:51 POST /kubernetes-auth/login
    outlier:  backend/src/server/routes/v1/identity-ldap-auth-router.ts:143 POST /ldap-auth/login
    outlier:  backend/src/server/routes/v1/identity-oci-auth-router.ts:19 POST /oci-auth/login
    outlier:  backend/src/server/routes/v1/identity-oidc-auth-router.ts:46 POST /oidc-auth/login
    outlier:  backend/src/server/routes/v1/identity-spiffe-auth-router.ts:107 POST /spiffe-auth/login
    outlier:  backend/src/server/routes/v1/identity-tls-cert-auth-router.ts:82 POST /login
    outlier:  backend/src/server/routes/v1/identity-universal-auth-router.ts:32 POST /universal-auth/login
    outlier:  backend/src/server/routes/v1/invite-org-router.ts:332 POST /verify
    outlier:  backend/src/server/routes/v1/microsoft-teams-router.ts:376 POST /message-endpoint
    outlier:  backend/src/server/routes/v1/oauth-router.ts:318 GET /authorize
    outlier:  backend/src/server/routes/v1/oauth-router.ts:356 GET /authorize/info
    outlier:  backend/src/server/routes/v1/oauth-router.ts:450 POST /token
    outlier:  backend/src/server/routes/v1/oidc-issuer-router.ts:44 GET /organizations/:organizationId/.well-known/jwks.json
    outlier:  backend/src/server/routes/v1/oidc-issuer-router.ts:16 GET /organizations/:organizationId/.well-known/openid-configuration
    outlier:  backend/src/server/routes/v1/secret-requests-router.ts:16 GET /:id
    outlier:  backend/src/server/routes/v1/secret-requests-router.ts:84 GET /:id/branding/:assetType
    outlier:  backend/src/server/routes/v1/secret-requests-router.ts:119 POST /:id/set-value
    outlier:  backend/src/server/routes/v1/secret-sharing-router.ts:84 GET /:id
    outlier:  backend/src/server/routes/v1/secret-sharing-router.ts:577 GET /branding
    outlier:  backend/src/server/routes/v1/secret-sharing-router.ts:446 GET /public/:id/branding/:assetType
    outlier:  backend/src/server/routes/v1/secret-sharing-router.ts:123 POST /:id/access
    outlier:  backend/src/server/routes/v1/secret-sharing-router.ts:192 POST /public
    outlier:  backend/src/server/routes/v1/slack-router.ts:328 GET /oauth_redirect
    outlier:  backend/src/server/routes/v1/sso-router.ts:663 GET /redirect/organizations/:orgSlug
    outlier:  backend/src/server/routes/v1/sso-router.ts:816 POST /token-exchange
    outlier:  backend/src/server/routes/v1/user-router.ts:99 GET /:userId/unlock
    outlier:  backend/src/server/routes/v2/deprecated-project-router.ts:29 GET /:workspaceId/encrypted-key
    outlier:  backend/src/server/routes/v2/mfa-router.ts:105 GET /mfa/check/totp
    outlier:  backend/src/server/routes/v2/mfa-router.ts:202 GET /mfa/check/webauthn
    outlier:  backend/src/server/routes/v2/mfa-router.ts:85 POST /mfa/send
    outlier:  backend/src/server/routes/v2/mfa-router.ts:138 POST /mfa/verify
    outlier:  backend/src/server/routes/v2/mfa-router.ts:169 POST /mfa/verify/recovery-code
    outlier:  backend/src/server/routes/v2/password-router.ts:12 POST /password-reset
    outlier:  backend/src/server/routes/v2/user-router.ts:20 POST /me/emails/code
    outlier:  backend/src/server/routes/v3/login-router.ts:221 POST /login
    outlier:  backend/src/server/routes/v3/login-router.ts:14 POST /login1
    outlier:  backend/src/server/routes/v3/login-router.ts:136 POST /login2
    outlier:  backend/src/server/routes/v3/signup-router.ts:110 POST /complete-account
    outlier:  backend/src/server/routes/v3/signup-router.ts:21 POST /email/signup
    outlier:  backend/src/server/routes/v3/signup-router.ts:72 POST /email/verify
```

### uid: infisical/D-dfa77a

```text
[D-dfa77a] frontend: functions in src/hooks/api/identities/** (mutations files) call identitiesKeys.getIdentityById()
    evidence: 41/46 (lower bound 0.77, lift 202.9)
    example:  frontend/src/hooks/api/identities/mutations.tsx#useAddIdentityAliCloudAuth
    outlier:  frontend/src/hooks/api/identities/mutations.tsx:215 useCreateIdentityUniversalAuthClientSecret
    outlier:  frontend/src/hooks/api/identities/mutations.tsx:1793 useCreateTokenIdentityTokenAuth
    outlier:  frontend/src/hooks/api/identities/mutations.tsx:1837 useRevokeIdentityTokenAuthToken
    outlier:  frontend/src/hooks/api/identities/mutations.tsx:241 useRevokeIdentityUniversalAuthClientSecret
    outlier:  frontend/src/hooks/api/identities/mutations.tsx:1814 useUpdateIdentityTokenAuthToken
```

### uid: infisical/D-536c03

```text
[D-536c03] frontend: components in src/components/secret-syncs/forms/** are named `*Fields`
    evidence: 128/135 (lower bound 0.90, lift 7.9)
    example:  frontend/src/components/secret-syncs/forms/AzureEntraIdScimSyncSourceFields.tsx#AzureEntraIdScimSyncSourceFields
    outlier:  frontend/src/components/secret-syncs/forms/CreateSecretSyncForm.tsx:151 CreateSecretSyncForm
    outlier:  frontend/src/components/secret-syncs/forms/DuplicateDestinationConfirmationModal.tsx:24 DuplicateDestinationConfirmationModal
    outlier:  frontend/src/components/secret-syncs/forms/EditSecretSyncForm.tsx:130 EditSecretSyncForm
    outlier:  frontend/src/components/secret-syncs/forms/SecretSyncConnectionField.tsx:34 SecretSyncConnectionField
    outlier:  frontend/src/components/secret-syncs/forms/SecretSyncDestinationFields/shared/AwsRegionSelect.tsx:23 AwsRegionSelect
    outlier:  frontend/src/components/secret-syncs/forms/SecretSyncInitialSyncBehaviorFields.tsx:286 InitialSyncAlerts
    outlier:  frontend/src/components/secret-syncs/forms/SecretSyncOptionsFields/SecretSyncKeySchemaField.tsx:62 SecretSyncKeySchemaField
```

### uid: infisical/D-fd3f1a

```text
[D-fd3f1a] frontend: components in src/components/secret-rotations-v2/forms/SecretRotationV2ReviewFields/** render <SecretRotationReviewSection>
    evidence: 27/29 (lower bound 0.78, lift 87.0)
    example:  frontend/src/components/secret-rotations-v2/forms/SecretRotationV2ReviewFields/Auth0ClientSecretRotationReviewFields.tsx#Auth0ClientSecretRotationReviewFields
    outlier:  frontend/src/components/secret-rotations-v2/forms/SecretRotationV2ReviewFields/SecretRotationReviewFields.tsx:71 SecretRotationV2ReviewFields
    outlier:  frontend/src/components/secret-rotations-v2/forms/SecretRotationV2ReviewFields/shared/SecretRotationReviewSection.tsx:10 SecretRotationReviewSection
```

### uid: infisical/D-16b725

```text
[D-16b725] backend: HTTP handlers in src/ee/routes/v1/agent-vault-routers/** call actorContext()
    evidence: 64/72 (lower bound 0.80, lift 114.9)
    example:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-access-bundle-router.ts#DELETE /:accessBundleId
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-project-router.ts:9 GET /
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-proxy-agent-router.ts:84 POST /bootstrap
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-proxy-agent-router.ts:125 POST /heartbeat
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-proxy-agent-router.ts:140 POST /resolve
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-proxy-agent-router.ts:211 POST /services/:serviceId/credential-refresh
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-proxy-agent-router.ts:246 POST /services/:serviceId/missing-scopes
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-proxy-agent-router.ts:293 POST /sessions/:sessionId/logs/chunks
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-session-skill-router.ts:50 GET /skills
```

### uid: infisical/D-156a6f

```text
[D-156a6f] backend: functions in src/server/routes/** are named `register*`
    evidence: 327/349 (lower bound 0.91, lift 18.9)
    example:  backend/src/server/routes/bdd/bdd-nock-router.dev.ts#registerBddNockRouter
    outlier:  backend/src/server/routes/mfa-step-up-fns.ts:117 ensureFactorEnrollmentStepUpMfa
    outlier:  backend/src/server/routes/mfa-step-up-fns.ts:37 ensureStepUpMfa
    outlier:  backend/src/server/routes/mfa-step-up-fns.ts:14 getStepUpSessionId
    outlier:  backend/src/server/routes/sanitizedSchema/permission.ts:15 unpackPermissions
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:49 buildAppConnectionRouteContext
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:319 buildCreateAppConnectionRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:502 buildDeleteAppConnectionRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:254 buildGetAppConnectionByNameRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:201 buildGetAppConnectionRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:86 buildListAppConnectionsRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:137 buildListAvailableAppConnectionsRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:568 buildRotateAppConnectionCredentialsRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:411 buildUpdateAppConnectionRoute
    outlier:  backend/src/server/routes/v1/dashboard-secret-search-fns.ts:42 isInSecretSearchScope
    outlier:  backend/src/server/routes/v1/dashboard-secret-search-fns.ts:40 isSecretPathMatch
    outlier:  backend/src/server/routes/v1/dashboard-secret-search-fns.ts:10 parseSecretPathSearch
    outlier:  backend/src/server/routes/v1/dashboard-secret-search-fns.ts:54 resolveSecretDeepSearch
    outlier:  backend/src/server/routes/v1/hsm-connector-router-schemas.ts:54 UpdateHsmConnectorBodySchema
    outlier:  backend/src/server/routes/v1/hsm-connector-router-schemas.ts:13 gatewayPickRefiner
    outlier:  backend/src/server/routes/v1/hsm-connector-router.ts:26 createHsmConnectorRouter
    outlier:  backend/src/server/routes/v1/sso-router.ts:423 initializeOauthConfigSync
    outlier:  backend/src/server/routes/v1/sso-router.ts:413 refreshOauthConfig
```

### uid: infisical/D-7731c9

```text
[D-7731c9] backend: HTTP handlers in src/server/routes/v3/** are wrapped in verifyAuth()
    evidence: 44/50 (lower bound 0.76, lift 5.3)
    example:  backend/src/server/routes/v3/deprecated-certificates-router.ts#PATCH /:certificateId/config
    outlier:  backend/src/server/routes/v3/login-router.ts:221 POST /login
    outlier:  backend/src/server/routes/v3/login-router.ts:14 POST /login1
    outlier:  backend/src/server/routes/v3/login-router.ts:136 POST /login2
    outlier:  backend/src/server/routes/v3/signup-router.ts:110 POST /complete-account
    outlier:  backend/src/server/routes/v3/signup-router.ts:21 POST /email/signup
    outlier:  backend/src/server/routes/v3/signup-router.ts:72 POST /email/verify
```

### uid: infisical/D-1e9bb3

```text
[D-1e9bb3] backend: HTTP handlers in src/server/routes/v2/** are wrapped in verifyAuth()
    evidence: 88/96 (lower bound 0.84, lift 5.6)
    example:  backend/src/server/routes/v2/certificate-authority-router.ts#GET /
    outlier:  backend/src/server/routes/v2/deprecated-project-router.ts:29 GET /:workspaceId/encrypted-key
    outlier:  backend/src/server/routes/v2/mfa-router.ts:105 GET /mfa/check/totp
    outlier:  backend/src/server/routes/v2/mfa-router.ts:202 GET /mfa/check/webauthn
    outlier:  backend/src/server/routes/v2/mfa-router.ts:85 POST /mfa/send
    outlier:  backend/src/server/routes/v2/mfa-router.ts:138 POST /mfa/verify
    outlier:  backend/src/server/routes/v2/mfa-router.ts:169 POST /mfa/verify/recovery-code
    outlier:  backend/src/server/routes/v2/password-router.ts:12 POST /password-reset
    outlier:  backend/src/server/routes/v2/user-router.ts:20 POST /me/emails/code
```

### uid: infisical/D-272621

```text
[D-272621] backend: functions in src/server/routes/v1/app-connection-routers/** pass `app` to registerAppConnectionEndpoints()
    evidence: 92/103 (lower bound 0.82, lift 89.9)
    example:  backend/src/server/routes/v1/app-connection-routers/1password-connection-router.ts#registerOnePassConnectionRouter
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:49 buildAppConnectionRouteContext
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:319 buildCreateAppConnectionRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:502 buildDeleteAppConnectionRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:254 buildGetAppConnectionByNameRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:201 buildGetAppConnectionRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:86 buildListAppConnectionsRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:137 buildListAvailableAppConnectionsRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:568 buildRotateAppConnectionCredentialsRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:411 buildUpdateAppConnectionRoute
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-endpoints.ts:628 registerAppConnectionEndpoints
    outlier:  backend/src/server/routes/v1/app-connection-routers/app-connection-router.ts:497 registerAppConnectionRouter
```

### uid: infisical/D-d7b5b7

```text
[D-d7b5b7] frontend: components in src/pages/secret-manager/SecretSyncDetailsByIDPage/** render <Detail>
    evidence: 64/68 (lower bound 0.86, lift 12.3)
    example:  frontend/src/pages/secret-manager/SecretSyncDetailsByIDPage/components/AzureEntraIdScimSyncSourceSection.tsx#AzureEntraIdScimSyncSourceSection
    outlier:  frontend/src/pages/secret-manager/SecretSyncDetailsByIDPage/SecretSyncDetailsByIDPage.tsx:148 SecretSyncDetailsByIDPage
    outlier:  frontend/src/pages/secret-manager/SecretSyncDetailsByIDPage/components/SecretSyncActionTriggers.tsx:53 SecretSyncActionTriggers
    outlier:  frontend/src/pages/secret-manager/SecretSyncDetailsByIDPage/components/SecretSyncAuditLogsSection.tsx:38 SecretSyncAuditLogsSection
    outlier:  frontend/src/pages/secret-manager/SecretSyncDetailsByIDPage/components/SecretSyncSourceSection.tsx:59 SecretSyncSourceSection
```

### uid: infisical/D-4be5e9

```text
[D-4be5e9] backend: functions in src/ee/routes/** are named `register*`
    evidence: 140/150 (lower bound 0.88, lift 18.8)
    example:  backend/src/ee/routes/est/certificate-est-router.ts#registerCertificateEstRouter
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-router-fns.ts:5 actorContext
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-schemas.ts:59 AgentVaultDescriptionSchema
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-schemas.ts:746 AgentVaultMemberIdsSchema
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-schemas.ts:801 AgentVaultMemberRevokeIdsSchema
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-schemas.ts:770 AgentVaultProductMemberAddSchema
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-schemas.ts:757 AgentVaultProductMemberIdsSchema
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-schemas.ts:789 AgentVaultProductMemberRoleUpdateSchema
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-schemas.ts:371 AgentVaultUpdateServiceBodySchema
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-schemas.ts:654 AgentVaultVariableValueSchema
    outlier:  backend/src/ee/routes/v1/agent-vault-routers/agent-vault-schemas.ts:882 agentVaultListQuery
```
