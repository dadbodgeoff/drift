You are adjudicating labels of proposed coding conventions for the repository **netbox** (https://github.com/netbox-community/netbox at commit `56daec7debfd51fa991b45d6a40cb592b42b669d`).

Two reviewers labelled each proposal below independently, following the rubric, and they disagreed. Your label is final. A checkout of the repository at that commit is at:

    /tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/repos/netbox

## Rules for this task

1. **Work only from the repository checkout.**
   - Read and search inside `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/repos/netbox`.
   - Do not modify it, install dependencies, run builds, or access the network.
   - Do not open anything outside it, except for writing your output file.
   - Ignore any `.drift/` directory.
2. **Do not decide by majority or by deference.**
   - Re-open the files yourself: the example, the outliers, other members, and configs.
   - Then apply the rubric's questions in order.
   - The reviewers' reasons tell you where to look, not what to conclude.
   - When a reviewer claims a lint rule, a framework requirement or a type error makes the rule TRIVIAL, verify it in the config or code. An unverified claim does not count.
3. **Your label may be any of the three,** including one neither reviewer chose.
4. **Write one JSON object per case to `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/outbox/61dcc977-8a4e-49ee-959d-66279e6ac68a/out.jsonl`,** using the rubric's output format, with these differences:
   - an extra field `"sided_with"`: `"1"` or `"2"` if your label is that reviewer's label, `"neither"` if it is a third label;
   - `"reason"` explains what settled it, citing files.
5. **When you finish, reply with one line:** the number of cases and the count of each label.

## Rubric

### Labelling rubric v2: proposed codebase conventions

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

##### Q2. Would a tool already catch a violation?

**Which violation.** Imagine a new member of the group that breaks the rule **the way the outliers you opened break it**. For example, if the outliers are classes that simply don't extend `BaseController`, imagine another such class, not a subclass missing a method. If the proposal has no outliers, imagine the simplest violation: the member without the required wrapper, decorator, base class, argument or name.

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

Label **ACCEPT** if yes. Typical ACCEPTs:

- an auth or permission wrapper;
- a required base class, decorator or argument;
- a layering boundary;
- a shared helper everyone is meant to use;
- a naming scheme the team chose.

For security-relevant rules (authentication, authorization, input validation), legitimate exceptions do not make the rule WRONG. A public webhook that skips the auth wrapper is still worth confirming. Label ACCEPT when the exceptions are the kind a reviewer would want to confirm.

Otherwise label **WRONG** and say why:

| `wrong_because` | Meaning |
| --- | --- |
| `mixed_group` | The group mixes unlike things, so the rule should not apply to a large part of it. Examples: co-located helpers in hook files, re-exports, base or abstract classes next to their subclasses, generated files, examples or fixtures mined as production code. |
| `legit_outliers` | The outliers are legitimately different, as a **recurring category**, and new members of that category would get false alarms. Examples: email routes that must import React, read-only endpoints without a body schema. |
| `incidental` | True, but a coincidence or a consequence of what the code does, not a choice. For example, "components call `useState`": new members that don't need state would be flagged for nothing. |

##### Clear?

Separately, say whether a developer reading only the rule's wording would know what to do: `clear: true/false`.

#### Output

One JSON object per proposal, one per line (JSONL). Field order does not matter. The examples below are made up: the repository `acme-shop` does not exist.

```json
{"uid": "acme-shop/D-0a1b2c", "rubric": "v2",
 "label": "ACCEPT", "trivial_by": null, "trivial_evidence": null, "lint_severity": null, "wrong_because": null,
 "clear": true, "confidence": "high",
 "checked": ["api/orders/list.ts", "api/orders/refund.ts", "api/health.ts", "api/orders/create.ts", "api/carts/get.ts", "lib/auth.ts"],
 "outliers": [{"symbol": "refund", "verdict": "mistake"}, {"symbol": "health", "verdict": "legit"}],
 "reason": "Order handlers call requireShopUser() first (list.ts, create.ts); refund.ts skips it and reads another shop's order, while health.ts is a public probe.",
 "defects": ["api/orders/refund.ts:12 refund handler has no requireShopUser() check"]}
{"uid": "acme-shop/D-3d4e5f", "rubric": "v2",
 "label": "TRIVIAL", "trivial_by": "lint", "trivial_evidence": "eslint.config.js: no-restricted-imports error for 'lodash' (use lodash-es); the one outlier has an eslint-disable-next-line", "lint_severity": "error", "wrong_because": null,
 "clear": true, "confidence": "high",
 "checked": ["eslint.config.js", "web/cart.tsx", "web/legacy/export.ts", "web/search.tsx", "web/checkout.tsx"],
 "reason": "The import ban is already an error in eslint.config.js; the outlier in legacy/export.ts suppresses it explicitly."}
{"uid": "acme-shop/D-6a7b8c", "rubric": "v2",
 "label": "WRONG", "trivial_by": null, "trivial_evidence": null, "lint_severity": null, "wrong_because": "incidental",
 "clear": true, "confidence": "low",
 "checked": ["web/cart.tsx", "web/footer.tsx", "web/badge.tsx", "web/logo.tsx", "web/search.tsx", "web/checkout.tsx"],
 "outliers": [{"symbol": "Footer", "verdict": "legit"}, {"symbol": "Badge", "verdict": "legit"}, {"symbol": "Logo", "verdict": "legit"}],
 "reason": "Components call useState because most of them hold state (cart.tsx); the outliers are stateless (footer.tsx, badge.tsx), so new stateless components would be flagged for nothing. Hesitated with ACCEPT."}
```

Write only the fields below.

| Field | Required | Values |
| --- | --- | --- |
| `uid` | yes | as given in the proposal header |
| `rubric` | yes | `"v2"` |
| `label` | yes | `ACCEPT`, `TRIVIAL` or `WRONG` |
| `trivial_by` | if TRIVIAL | `build`, `types`, `framework`, `lint` or `tautology` |
| `trivial_evidence` | if TRIVIAL by a tool | the config file and rule, or the error; for `warn_enforced`, also the CI or hook line |
| `lint_severity` | if TRIVIAL by `lint` | `error` or `warn_enforced` |
| `wrong_because` | if WRONG | `misdescribes`, `false_outliers`, `mixed_group`, `legit_outliers`, `incidental` or `team_disabled` |
| `clear` | yes | `true` or `false` |
| `confidence` | yes | `high`, or `low` when you hesitated between two labels (name both in `reason`) |
| `checked` | yes | the repo-relative files you opened: <ul><li>the example's file;</li><li>at least 3 outliers' files (all if fewer);</li><li>at least 2 further files with other members;</li><li>configs.</li></ul> `collect.mjs` rejects a list that misses these. |
| `outliers` | recommended | one entry per outlier opened, with `verdict`: <ul><li>`mistake`</li><li>`look` (worth a second look)</li><li>`legit` (legitimately different)</li><li>`not_violation` (it actually follows the rule)</li></ul> |
| `reason` | yes | one or two sentences citing what you saw in specific files |
| `defects` | optional | outliers that look like real bugs in the project, with file:line |

Decide each proposal on its own merits. There is no expected distribution of labels.

## Cases (3)

### uid: netbox/D-bc0c7d

```text
[D-bc0c7d] classes in netbox/** (search files) are decorated with register_search()
    evidence: 98/100 (lower bound 0.93, lift 40.3)
    example:  netbox/circuits/search.py#CircuitGroupIndex
    outlier:  netbox/extras/models/search.py:16 CachedValue
    outlier:  netbox/netbox/forms/search.py:18 SearchForm
```

**Reviewer 1: ACCEPT**
- reason: SearchIndex classes in each app's search.py must be @register_search'd or they silently drop out of global search (netbox/search/__init__.py only adds to the registry); the two outliers are a model and a form in other search.py files, not indexes. Hesitated with WRONG mixed_group.
- checked: netbox/circuits/search.py, netbox/extras/models/search.py, netbox/netbox/forms/search.py, netbox/dcim/search.py, netbox/ipam/search.py, netbox/netbox/search/__init__.py
- outlier verdicts: CachedValue: legit; SearchForm: legit

**Reviewer 2: WRONG** (wrong_because: mixed_group)
- reason: SearchIndex classes in app search.py files are all @register_search (circuits, dcim, ipam), but the outliers come from unrelated files that share the name: CachedValue is a model (extras/models/search.py) and SearchForm a form (netbox/forms/search.py), so the group mixes in non-indexes. Hesitated with ACCEPT for real search indexes.
- checked: netbox/circuits/search.py, netbox/extras/models/search.py, netbox/netbox/forms/search.py, netbox/dcim/search.py, netbox/ipam/search.py
- outlier verdicts: CachedValue: legit; SearchForm: legit

---

### uid: netbox/D-0eddf0

```text
[D-0eddf0] HTTP handlers in netbox/dcim/api/** (views files) extend NetBoxModelViewSet
    evidence: 51/52 (lower bound 0.90, lift 29.9)
    example:  netbox/dcim/api/views.py#CableBundleViewSet
    outlier:  netbox/dcim/api/views.py:596 CableTerminationViewSet
```

**Reviewer 1: WRONG** (wrong_because: legit_outliers)
- reason: Writable dcim API viewsets extend NetBoxModelViewSet (RegionViewSet, SiteViewSet, CableViewSet); the sole outlier CableTerminationViewSet is deliberately NetBoxReadOnlyModelViewSet, and read-only endpoints are a recurring category (core/api/views.py has four NetBoxReadOnlyModelViewSet viewsets) that would be flagged. Hesitated with ACCEPT. All members live in dcim/api/views.py, so no other member file exists.
- checked: netbox/dcim/api/views.py, netbox/netbox/api/viewsets/__init__.py, netbox/core/api/views.py
- outlier verdicts: CableTerminationViewSet: legit

**Reviewer 2: ACCEPT**
- reason: dcim API viewsets (SiteViewSet, DeviceViewSet, CableViewSet) extend NetBoxModelViewSet for permissions, bulk ops and changelog; the outlier is intentionally read-only (NetBoxReadOnlyModelViewSet), which is the kind of deviation a reviewer should confirm. Hesitated with WRONG legit_outliers. The role is a single file; ipam/api/views.py follows the same NetBoxModelViewSet pattern.
- checked: netbox/dcim/api/views.py, netbox/netbox/api/viewsets/__init__.py, netbox/circuits/api/views.py, netbox/dcim/api/urls.py, netbox/ipam/api/views.py
- outlier verdicts: CableTerminationViewSet: legit

---

### uid: netbox/D-7d7f0c

```text
[D-7d7f0c] files in the repo do not import from netbox/account/**
    evidence: 785/786 (lower bound 0.99, lift 3.0)
    example:  .claude/skills/draft-release-notes/audit_milestone.py#(file)
    outlier:  netbox/netbox/urls.py:1 (file)
```

**Reviewer 1: WRONG** (wrong_because: incidental)
- reason: account is a leaf UI app; the only importer, netbox/urls.py, must import LoginView/LogoutView/SocialAuthBeginView to route them. Nothing else imports it because nothing else needs it, so the rule is incidental.
- checked: .claude/skills/draft-release-notes/audit_milestone.py, netbox/netbox/urls.py, netbox/tenancy/views.py, netbox/circuits/choices.py, pyproject.toml
- outlier verdicts: netbox/urls.py: legit

**Reviewer 2: ACCEPT**
- reason: account is a leaf app of user-facing views (account/views.py); the only importer is the root urls.py, which must wire LoginView/LogoutView, and other code importing these views would be a layering smell worth a look. Hesitated with WRONG incidental, since nothing else has a reason to import it.
- checked: .claude/skills/draft-release-notes/audit_milestone.py, netbox/netbox/urls.py, netbox/account/views.py, netbox/dcim/views.py, pyproject.toml, netbox/tenancy/views.py, netbox/vpn/views.py
- outlier verdicts: netbox/urls.py: legit
