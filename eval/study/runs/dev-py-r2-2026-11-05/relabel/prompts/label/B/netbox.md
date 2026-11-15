You are labelling proposed coding conventions for the repository **netbox** (https://github.com/netbox-community/netbox at commit `56daec7debfd51fa991b45d6a40cb592b42b669d`).

A checkout of the repository at that commit is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/r2/cache/repos/netbox

## Rules for this task

1. **Work only from the repository checkout.**
   - Read files, and search with grep, find or ripgrep, inside `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/r2/cache/repos/netbox`.
   - Do not modify anything there.
   - Do not install dependencies, run builds, or access the network.
2. **Do not open anything outside `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/r2/cache/repos/netbox`,** except for writing your output file. In particular, do not look for:
   - the tool that produced these proposals, or its source code or documentation;
   - other people's labels, or earlier studies;
   - anything on the internet.
3. **Ignore a `.drift/` directory if one exists in the checkout.** It is a cache of the tool, not part of the project.
4. **Label every proposal independently,** following the rubric below exactly.
   - Open the files the rubric requires before deciding: the example, at least three outliers, at least two other members, and the lint or compiler config when TRIVIAL is in question.
   - List every file you opened in `checked`.
5. **Write your labels to `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/r2/cache/outbox/cc0fd848-e548-482d-9716-8ba98fe18239/out.jsonl`:**
   - one JSON object per line;
   - exactly one line for each of the 11 proposals;
   - no other text in the file.
   The directory already exists. If you stop early, the lines you wrote must still be valid.
6. **When you finish, reply with one line:** the number of proposals labelled, and the count of each label. Do not repeat the reasons.

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

## The proposals (11)

Each proposal starts with its `uid`. Copy it exactly into your output.

### uid: netbox/D-e5e365

```text
[D-e5e365] classes in netbox/** (forms/filtersets files) pass `name` to FieldSet()
    evidence: 129/136 (lower bound 0.90, lift 14.1)
    example:  netbox/circuits/forms/filtersets.py#CircuitFilterForm
    outlier:  netbox/core/forms/filtersets.py:190 ConfigRevisionFilterForm
    outlier:  netbox/dcim/forms/filtersets.py:2495 ConsoleConnectionFilterForm
    outlier:  netbox/dcim/forms/filtersets.py:2543 InterfaceConnectionFilterForm
    outlier:  netbox/dcim/forms/filtersets.py:2519 PowerConnectionFilterForm
    outlier:  netbox/extras/forms/filtersets.py:640 NotificationGroupFilterForm
    outlier:  netbox/users/forms/filtersets.py:24 GroupFilterForm
    outlier:  netbox/users/forms/filtersets.py:154 OwnerGroupFilterForm
```

### uid: netbox/D-89919d

```text
[D-89919d] classes in netbox/** (forms/filtersets files) call FieldSet() before TagFilterField()
    evidence: 98/99 (lower bound 0.94, lift 1.0)
    example:  netbox/circuits/forms/filtersets.py#CircuitFilterForm
    outlier:  netbox/virtualization/forms/filtersets.py:42 ClusterGroupFilterForm
```

### uid: netbox/D-c50348

```text
[D-c50348] classes in netbox/** (graphql/filters files) call filter_field()
    evidence: 126/135 (lower bound 0.88, lift 23.7)
    example:  netbox/circuits/graphql/filters.py#CircuitFilter
    outlier:  netbox/circuits/graphql/filters.py:130 CircuitGroupFilter
    outlier:  netbox/circuits/graphql/filters.py:125 CircuitTypeFilter
    outlier:  netbox/circuits/graphql/filters.py:180 VirtualCircuitTypeFilter
    outlier:  netbox/dcim/graphql/filters.py:732 ManufacturerFilter
    outlier:  netbox/dcim/graphql/filters.py:1185 RackGroupFilter
    outlier:  netbox/tenancy/graphql/filters.py:171 ContactRoleFilter
    outlier:  netbox/virtualization/graphql/filters.py:67 ClusterTypeFilter
    outlier:  netbox/vpn/graphql/filters.py:40 TunnelGroupFilter
    outlier:  netbox/wireless/graphql/filters.py:29 WirelessLANGroupFilter
```

### uid: netbox/D-cc1341

```text
[D-cc1341] classes in netbox/** (filtersets files) are decorated with register_filterset()
    evidence: 138/141 (lower bound 0.94, lift 28.5)
    example:  netbox/circuits/filtersets.py#CircuitFilterSet
    outlier:  netbox/dcim/filtersets.py:3478 ConsoleConnectionFilterSet
    outlier:  netbox/dcim/filtersets.py:3492 InterfaceConnectionFilterSet
    outlier:  netbox/dcim/filtersets.py:3485 PowerConnectionFilterSet
```

### uid: netbox/D-cc8d72

```text
[D-cc8d72] classes in netbox/** (forms/filtersets files) call FieldSet()
    evidence: 132/136 (lower bound 0.93, lift 10.7)
    example:  netbox/circuits/forms/filtersets.py#CircuitFilterForm
    outlier:  netbox/dcim/forms/filtersets.py:2495 ConsoleConnectionFilterForm
    outlier:  netbox/dcim/forms/filtersets.py:2543 InterfaceConnectionFilterForm
    outlier:  netbox/dcim/forms/filtersets.py:2519 PowerConnectionFilterForm
    outlier:  netbox/extras/forms/filtersets.py:640 NotificationGroupFilterForm
```

### uid: netbox/D-310ec7

```text
[D-310ec7] classes in netbox/ipam/tables/** pass `verbose_name` to Column()
    evidence: 22/23 (lower bound 0.79, lift 26.1)
    example:  netbox/ipam/tables/asn.py#ASNRangeTable
    outlier:  netbox/ipam/tables/ip.py:373 AnnotatedIPAddressTable
```

### uid: netbox/D-afb64d

```text
[D-afb64d] classes in netbox/** (choices files) are named `*Choices`
    evidence: 115/119 (lower bound 0.92, lift 33.7)
    example:  netbox/circuits/choices.py#CircuitCommitRateChoices
    outlier:  netbox/utilities/choices.py:19 Choice
    outlier:  netbox/utilities/forms/fields/choices.py:76 ChoiceField
    outlier:  netbox/utilities/forms/fields/choices.py:96 MultipleChoiceField
    outlier:  netbox/utilities/forms/fields/choices.py:83 TypedChoiceField
```

### uid: netbox/D-e2c3e4

```text
[D-e2c3e4] classes in netbox/** (choices files) extend ChoiceSet
    evidence: 114/119 (lower bound 0.91, lift 33.7)
    example:  netbox/circuits/choices.py#CircuitCommitRateChoices
    outlier:  netbox/extras/choices.py:305 EventRuleActionChoices
    outlier:  netbox/utilities/choices.py:19 Choice
    outlier:  netbox/utilities/forms/fields/choices.py:76 ChoiceField
    outlier:  netbox/utilities/forms/fields/choices.py:96 MultipleChoiceField
    outlier:  netbox/utilities/forms/fields/choices.py:83 TypedChoiceField
```

### uid: netbox/D-937c0c

```text
[D-937c0c] classes in netbox/ipam/api/** are named `*Serializer`
    evidence: 27/29 (lower bound 0.78, lift 18.2)
    example:  netbox/ipam/api/serializers_/asns.py#ASNRangeSerializer
    outlier:  netbox/ipam/api/field_serializers.py:11 IPAddressField
    outlier:  netbox/ipam/api/field_serializers.py:31 IPNetworkField
```

### uid: netbox/D-58913a

```text
[D-58913a] classes in netbox/** (choices files) call Choice()
    evidence: 106/119 (lower bound 0.82, lift 33.7)
    example:  netbox/circuits/choices.py#CircuitCommitRateChoices
    outlier:  netbox/dcim/choices.py:2267 CoolingConnectorTypeChoices
    outlier:  netbox/dcim/choices.py:2225 CoolingFeedStatusChoices
    outlier:  netbox/dcim/choices.py:2177 CoolingMethodChoices
    outlier:  netbox/dcim/choices.py:2209 CoolingSourceStatusChoices
    outlier:  netbox/dcim/choices.py:2191 CoolingSourceTypeChoices
    outlier:  netbox/dcim/choices.py:2241 FluidTypeChoices
    outlier:  netbox/dcim/choices.py:2255 RackCoolingCapabilityChoices
    outlier:  netbox/extras/choices.py:50 CustomFieldStatusChoices
    outlier:  netbox/extras/choices.py:305 EventRuleActionChoices
    outlier:  netbox/utilities/choices.py:19 Choice
    outlier:  netbox/utilities/forms/fields/choices.py:76 ChoiceField
    outlier:  netbox/utilities/forms/fields/choices.py:96 MultipleChoiceField
    outlier:  netbox/utilities/forms/fields/choices.py:83 TypedChoiceField
```

### uid: netbox/D-73d13c

```text
[D-73d13c] HTTP handlers in netbox/** (api/views files) are named `*Set`
    evidence: 134/137 (lower bound 0.94, lift 12.1)
    example:  netbox/circuits/api/views.py#CircuitGroupAssignmentViewSet
    outlier:  netbox/extras/api/views.py:465 DashboardView
    outlier:  netbox/ipam/api/views.py:460 IPRangeAvailableIPAddressesView
    outlier:  netbox/ipam/api/views.py:454 PrefixAvailableIPAddressesView
```
