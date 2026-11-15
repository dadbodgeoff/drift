You are labelling proposed coding conventions for the repository **netbox** (https://github.com/netbox-community/netbox at commit `56daec7debfd51fa991b45d6a40cb592b42b669d`).

A checkout of the repository at that commit is at:

    /tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/repos/netbox

## Rules for this task

1. **Work only from the repository checkout.**
   - Read files, and search with grep, find or ripgrep, inside `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/repos/netbox`.
   - Do not modify anything there.
   - Do not install dependencies, run builds, or access the network.
2. **Do not open anything outside `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/repos/netbox`,** except for writing your output file. In particular, do not look for:
   - the tool that produced these proposals, or its source code or documentation;
   - other people's labels, or earlier studies;
   - anything on the internet.
3. **Ignore a `.drift/` directory if one exists in the checkout.** It is a cache of the tool, not part of the project.
4. **Label every proposal independently,** following the rubric below exactly.
   - Open the files the rubric requires before deciding: the example, at least three outliers, at least two other members, and the lint or compiler config when TRIVIAL is in question.
   - List every file you opened in `checked`.
5. **Write your labels to `/tmp/claude-0/-home-user-dub/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/eval-py/outbox/c54588b5-48d6-41b2-a023-cefec3d3cbf3/out.jsonl`:**
   - one JSON object per line;
   - exactly one line for each of the 15 proposals;
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

## The proposals (15)

Each proposal starts with its `uid`. Copy it exactly into your output.

### uid: netbox/D-e2c3e4

```text
[D-e2c3e4] classes in netbox/** (choices files) extend ChoiceSet
    evidence: 113/120 (lower bound 0.88, lift 33.6)
    example:  netbox/circuits/choices.py#CircuitCommitRateChoices
    outlier:  netbox/extras/choices.py:165 CustomLinkButtonClassChoices
    outlier:  netbox/extras/choices.py:305 EventRuleActionChoices
    outlier:  netbox/utilities/choices.py:19 Choice
    outlier:  netbox/utilities/choices.py:111 ChoiceSet
    outlier:  netbox/utilities/forms/fields/choices.py:76 ChoiceField
    outlier:  netbox/utilities/forms/fields/choices.py:96 MultipleChoiceField
    outlier:  netbox/utilities/forms/fields/choices.py:83 TypedChoiceField
```

### uid: netbox/D-436c3c

```text
[D-436c3c] classes in netbox/** (views files) are decorated with register_model_view()
    evidence: 1100/1189 (lower bound 0.91, lift 3.4)
    example:  netbox/account/views.py#UserTokenDeleteView
    outlier:  netbox/account/views.py:300 ChangePasswordView
    outlier:  netbox/account/views.py:47 LoginView
    outlier:  netbox/account/views.py:172 LogoutView
    outlier:  netbox/account/views.py:242 ProfileView
    outlier:  netbox/account/views.py:194 SocialAuthBeginView
    outlier:  netbox/account/views.py:259 UserConfigView
    outlier:  netbox/account/views.py:381 UserTokenListView
    outlier:  netbox/circuits/api/views.py:11 CircuitsRootView
    outlier:  netbox/core/api/views.py:164 BackgroundQueueViewSet
    outlier:  netbox/core/api/views.py:228 BackgroundTaskViewSet
    outlier:  netbox/core/api/views.py:197 BackgroundWorkerViewSet
    outlier:  netbox/core/api/views.py:119 BaseRQViewSet
    outlier:  netbox/core/api/views.py:30 CoreRootView
    outlier:  netbox/core/api/views.py:38 DataSourceViewSet
    outlier:  netbox/core/views.py:531 BackgroundQueueListView
    outlier:  netbox/core/views.py:599 BackgroundTaskDeleteView
    outlier:  netbox/core/views.py:634 BackgroundTaskEnqueueView
    outlier:  netbox/core/views.py:543 BackgroundTaskListView
    outlier:  netbox/core/views.py:626 BackgroundTaskRequeueView
    outlier:  netbox/core/views.py:643 BackgroundTaskStopView
    outlier:  netbox/core/views.py:572 BackgroundTaskView
    outlier:  netbox/core/views.py:850 BasePluginView
    outlier:  netbox/core/views.py:525 BaseRQView
    outlier:  netbox/core/views.py:869 PluginListView
    outlier:  netbox/core/views.py:894 PluginView
    outlier:  netbox/core/views.py:791 SystemDBSchemaView
    outlier:  netbox/core/views.py:709 SystemView
    outlier:  netbox/core/views.py:655 WorkerListView
    outlier:  netbox/core/views.py:688 WorkerView
    outlier:  netbox/dcim/api/views.py:670 ConnectedDeviceViewSet
    outlier:  netbox/dcim/api/views.py:29 DCIMRootView
    outlier:  netbox/dcim/api/views.py:81 PassThroughPortMixin
    outlier:  netbox/dcim/api/views.py:39 PathEndpointMixin
    outlier:  netbox/dcim/api/views.py:194 RackViewSet
    outlier:  netbox/dcim/views.py:112 BulkDisconnectView
    outlier:  netbox/dcim/views.py:77 DeviceComponentsView
    outlier:  netbox/dcim/views.py:84 DeviceTypeComponentsView
    outlier:  netbox/dcim/views.py:98 ModuleTypeComponentsView
    outlier:  netbox/dcim/views.py:173 PathTraceView
    outlier:  netbox/dcim/views.py:1072 RackElevationListView
    outlier:  netbox/dcim/views.py:5337 VirtualChassisRemoveMemberView
    outlier:  netbox/extras/api/views.py:241 ConfigTemplateViewSet
    outlier:  netbox/extras/api/views.py:76 CustomFieldChoiceSetViewSet
    outlier:  netbox/extras/api/views.py:35 ExtrasRootView
    outlier:  netbox/extras/api/views.py:312 ScriptViewSet
    outlier:  netbox/extras/views.py:1697 BaseScriptView
    outlier:  netbox/extras/views.py:1494 DashboardResetView
    outlier:  netbox/extras/views.py:1521 DashboardWidgetAddView
    outlier:  netbox/extras/views.py:1571 DashboardWidgetConfigView
    outlier:  netbox/extras/views.py:1612 DashboardWidgetDeleteView
    outlier:  netbox/extras/views.py:631 NotificationsView
    outlier:  netbox/extras/views.py:1165 ObjectConfigContextView
    outlier:  netbox/extras/views.py:1272 ObjectRenderConfigView
    outlier:  netbox/extras/views.py:1950 RenderMarkdownView
    outlier:  netbox/extras/views.py:1810 ScriptJobsView
    outlier:  netbox/extras/views.py:1663 ScriptListView
    outlier:  netbox/extras/views.py:1828 ScriptResultView
    outlier:  netbox/extras/views.py:1795 ScriptSourceView
    outlier:  netbox/extras/views.py:1716 ScriptView
    outlier:  netbox/ipam/api/views.py:316 AvailableASNsView
    outlier:  netbox/ipam/api/views.py:409 AvailableIPAddressesView
    outlier:  netbox/ipam/api/views.py:203 AvailableObjectsView
    outlier:  netbox/ipam/api/views.py:356 AvailablePrefixesView
    outlier:  netbox/ipam/api/views.py:466 AvailableVLANsView
    outlier:  netbox/ipam/api/views.py:31 IPAMRootView
    outlier:  netbox/ipam/api/views.py:106 IPAddressViewSet
    outlier:  netbox/ipam/views.py:565 ChildAvailabilityMixin
    outlier:  netbox/ipam/views.py:1922 ServicePortMappingsBulkEditMixin
    outlier:  netbox/netbox/api/views.py:19 APIRootView
    outlier:  netbox/netbox/api/views.py:68 AuthenticationCheckView
    outlier:  netbox/netbox/api/views.py:48 StatusView
    outlier:  netbox/netbox/plugins/views.py:14 InstalledPluginsAPIView
    outlier:  netbox/netbox/plugins/views.py:45 PluginsAPIRootView
    outlier:  netbox/tenancy/api/views.py:10 TenancyRootView
    outlier:  netbox/users/api/views.py:58 TokenProvisionView
    outlier:  netbox/users/api/views.py:114 UserConfigViewSet
    outlier:  netbox/users/api/views.py:22 UsersRootView
    outlier:  netbox/utilities/testing/views.py:31 ModelViewTestCase
    outlier:  netbox/utilities/testing/views.py:58 ViewTestCases
    outlier:  netbox/utilities/views.py:45 ConditionalLoginRequiredMixin
    outlier:  netbox/utilities/views.py:70 ContentTypePermissionRequiredMixin
    outlier:  netbox/utilities/views.py:189 GetRelatedModelsMixin
    outlier:  netbox/utilities/views.py:156 GetReturnURLMixin
    outlier:  netbox/utilities/views.py:106 ObjectPermissionRequiredMixin
    outlier:  netbox/utilities/views.py:55 TokenConditionalLoginRequiredMixin
    outlier:  netbox/utilities/views.py:246 ViewTab
    outlier:  netbox/virtualization/api/views.py:14 VirtualizationRootView
    outlier:  netbox/vpn/api/views.py:24 VPNRootView
    outlier:  netbox/wireless/api/views.py:10 WirelessRootView
```

### uid: netbox/D-dd6307

```text
[D-dd6307] files in the repo do not import from netbox/wireless/**
    evidence: 771/786 (lower bound 0.97, lift 3.0)
    example:  .claude/skills/draft-release-notes/audit_milestone.py#(file)
    outlier:  netbox/dcim/api/serializers_/device_components.py:1 (file)
    outlier:  netbox/dcim/api/serializers_/devicetype_components.py:1 (file)
    outlier:  netbox/dcim/filtersets.py:1 (file)
    outlier:  netbox/dcim/forms/bulk_edit.py:1 (file)
    outlier:  netbox/dcim/forms/bulk_import.py:1 (file)
    outlier:  netbox/dcim/forms/filtersets.py:1 (file)
    outlier:  netbox/dcim/forms/model_forms.py:1 (file)
    outlier:  netbox/dcim/forms/object_import.py:1 (file)
    outlier:  netbox/dcim/management/commands/buildschema.py:1 (file)
    outlier:  netbox/dcim/models/cables.py:1 (file)
    outlier:  netbox/dcim/models/device_component_templates.py:1 (file)
    outlier:  netbox/dcim/models/device_components.py:1 (file)
    outlier:  netbox/dcim/svg/cables.py:1 (file)
    outlier:  netbox/dcim/views.py:1 (file)
    outlier:  netbox/netbox/graphql/schema.py:1 (file)
```

### uid: netbox/D-4fabef

```text
[D-4fabef] classes in netbox/** (filters files) are decorated with register_filter()
    evidence: 135/162 (lower bound 0.77, lift 24.9)
    example:  netbox/circuits/graphql/filters.py#CircuitFilter
    outlier:  netbox/extras/filters.py:16 MissingKeyAwareFilterMixin
    outlier:  netbox/extras/filters.py:108 TagFilter
    outlier:  netbox/extras/filters.py:123 TagIDFilter
    outlier:  netbox/netbox/api/filters.py:11 OrderingFilter
    outlier:  netbox/netbox/graphql/filters.py:36 BaseModelFilter
    outlier:  netbox/netbox/graphql/filters.py:41 ChangeLoggedModelFilter
    outlier:  netbox/netbox/graphql/filters.py:59 NestedGroupModelFilter
    outlier:  netbox/netbox/graphql/filters.py:45 NetBoxModelFilter
    outlier:  netbox/netbox/graphql/filters.py:67 OrganizationalModelFilter
    outlier:  netbox/netbox/graphql/filters.py:75 PrimaryModelFilter
    outlier:  netbox/utilities/filters.py:218 ContentTypeFilter
    outlier:  netbox/utilities/filters.py:102 MultiValueArrayFilter
    outlier:  netbox/utilities/filters.py:87 MultiValueBigNumberFilter
    outlier:  netbox/utilities/filters.py:67 MultiValueCharFilter
    outlier:  netbox/utilities/filters.py:238 MultiValueContentTypeFilter
    outlier:  netbox/utilities/filters.py:72 MultiValueDateFilter
    outlier:  netbox/utilities/filters.py:77 MultiValueDateTimeFilter
    outlier:  netbox/utilities/filters.py:92 MultiValueDecimalFilter
    outlier:  netbox/utilities/filters.py:151 MultiValueMACAddressFilter
    outlier:  netbox/utilities/filters.py:82 MultiValueNumberFilter
    outlier:  netbox/utilities/filters.py:97 MultiValueTimeFilter
    outlier:  netbox/utilities/filters.py:156 MultiValueTimeZoneFilter
    outlier:  netbox/utilities/filters.py:161 MultiValueWWNFilter
    outlier:  netbox/utilities/filters.py:181 NonUniqueModelMultipleChoiceFilter
    outlier:  netbox/utilities/filters.py:195 NullableCharFieldFilter
    outlier:  netbox/utilities/filters.py:206 NumericArrayFilter
    outlier:  netbox/utilities/filters.py:166 TreeNodeMultipleChoiceFilter
```

### uid: netbox/D-4cf3e5

```text
[D-4cf3e5] classes in netbox/dcim/forms/** (filtersets files) pass `name` to FieldSet()
    evidence: 53/56 (lower bound 0.85, lift 14.1)
    example:  netbox/dcim/forms/filtersets.py#CableBundleFilterForm
    outlier:  netbox/dcim/forms/filtersets.py:2495 ConsoleConnectionFilterForm
    outlier:  netbox/dcim/forms/filtersets.py:2543 InterfaceConnectionFilterForm
    outlier:  netbox/dcim/forms/filtersets.py:2519 PowerConnectionFilterForm
```

### uid: netbox/D-593fc9

```text
[D-593fc9] files in the repo do not import from netbox/circuits/**
    evidence: 776/786 (lower bound 0.98, lift 3.0)
    example:  .claude/skills/draft-release-notes/audit_milestone.py#(file)
    outlier:  netbox/dcim/filtersets.py:1 (file)
    outlier:  netbox/dcim/forms/connections.py:1 (file)
    outlier:  netbox/dcim/graphql/gfk_mixins.py:1 (file)
    outlier:  netbox/dcim/graphql/types.py:1 (file)
    outlier:  netbox/dcim/models/cables.py:1 (file)
    outlier:  netbox/dcim/views.py:1 (file)
    outlier:  netbox/ipam/filtersets.py:1 (file)
    outlier:  netbox/ipam/graphql/types.py:1 (file)
    outlier:  netbox/ipam/views.py:1 (file)
    outlier:  netbox/netbox/graphql/schema.py:1 (file)
```

### uid: netbox/D-58913a

```text
[D-58913a] classes in netbox/** (choices files) call Choice()
    evidence: 106/120 (lower bound 0.81, lift 33.6)
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
    outlier:  netbox/utilities/choices.py:111 ChoiceSet
    outlier:  netbox/utilities/forms/fields/choices.py:76 ChoiceField
    outlier:  netbox/utilities/forms/fields/choices.py:96 MultipleChoiceField
    outlier:  netbox/utilities/forms/fields/choices.py:83 TypedChoiceField
```

### uid: netbox/D-7f5847

```text
[D-7f5847] files in the repo do not import from netbox/vpn/**
    evidence: 777/786 (lower bound 0.98, lift 3.0)
    example:  .claude/skills/draft-release-notes/audit_milestone.py#(file)
    outlier:  netbox/dcim/api/serializers_/device_components.py:1 (file)
    outlier:  netbox/dcim/filtersets.py:1 (file)
    outlier:  netbox/dcim/forms/filtersets.py:1 (file)
    outlier:  netbox/ipam/api/serializers_/vlans.py:1 (file)
    outlier:  netbox/ipam/filtersets.py:1 (file)
    outlier:  netbox/ipam/forms/filtersets.py:1 (file)
    outlier:  netbox/netbox/graphql/schema.py:1 (file)
    outlier:  netbox/virtualization/api/serializers_/virtualmachines.py:1 (file)
    outlier:  netbox/virtualization/forms/filtersets.py:1 (file)
```

### uid: netbox/D-bc0c7d

```text
[D-bc0c7d] classes in netbox/** (search files) are decorated with register_search()
    evidence: 98/100 (lower bound 0.93, lift 40.3)
    example:  netbox/circuits/search.py#CircuitGroupIndex
    outlier:  netbox/extras/models/search.py:16 CachedValue
    outlier:  netbox/netbox/forms/search.py:18 SearchForm
```

### uid: netbox/D-4c4e2d

```text
[D-4c4e2d] classes in netbox/** (model_forms files) call FieldSet()
    evidence: 127/150 (lower bound 0.78, lift 9.4)
    example:  netbox/circuits/forms/model_forms.py#CircuitForm
    outlier:  netbox/dcim/forms/model_forms.py:1044 CableForm
    outlier:  netbox/dcim/forms/model_forms.py:1386 ConsolePortTemplateForm
    outlier:  netbox/dcim/forms/model_forms.py:1400 ConsoleServerPortTemplateForm
    outlier:  netbox/dcim/forms/model_forms.py:770 DeviceForm
    outlier:  netbox/dcim/forms/model_forms.py:1260 DeviceVCMembershipForm
    outlier:  netbox/dcim/forms/model_forms.py:2281 PopulateDeviceBayForm
    outlier:  netbox/dcim/forms/model_forms.py:1301 VCMemberSelectForm
    outlier:  netbox/dcim/forms/model_forms.py:1240 VirtualChassisForm
    outlier:  netbox/extras/forms/model_forms.py:525 BookmarkForm
    outlier:  netbox/extras/forms/model_forms.py:920 JournalEntryForm
    outlier:  netbox/extras/forms/model_forms.py:536 NotificationGroupForm
    outlier:  netbox/extras/forms/model_forms.py:562 SubscriptionForm
    outlier:  netbox/extras/forms/model_forms.py:446 TableConfigForm
    outlier:  netbox/ipam/forms/model_forms.py:551 IPAddressAssignForm
    outlier:  netbox/ipam/forms/model_forms.py:703 VLANForm
    outlier:  netbox/netbox/forms/model_forms.py:134 NestedGroupModelForm
    outlier:  netbox/netbox/forms/model_forms.py:21 NetBoxModelForm
    outlier:  netbox/netbox/forms/model_forms.py:126 OrganizationalModelForm
    outlier:  netbox/netbox/forms/model_forms.py:119 PrimaryModelForm
    outlier:  netbox/users/forms/model_forms.py:172 TokenForm
    outlier:  netbox/users/forms/model_forms.py:128 UserTokenForm
    outlier:  netbox/virtualization/forms/model_forms.py:106 ClusterAddDevicesForm
    outlier:  netbox/virtualization/forms/model_forms.py:185 ClusterRemoveDevicesForm
```

### uid: netbox/D-0eddf0

```text
[D-0eddf0] HTTP handlers in netbox/dcim/api/** (views files) extend NetBoxModelViewSet
    evidence: 51/52 (lower bound 0.90, lift 29.9)
    example:  netbox/dcim/api/views.py#CableBundleViewSet
    outlier:  netbox/dcim/api/views.py:596 CableTerminationViewSet
```

### uid: netbox/D-76eb6b

```text
[D-76eb6b] classes in netbox/** (types files) pass `filters` to register_type()
    evidence: 131/143 (lower bound 0.86, lift 28.2)
    example:  netbox/circuits/graphql/types.py#CircuitGroupAssignmentType
    outlier:  netbox/core/graphql/types.py:49 ContentType
    outlier:  netbox/dcim/graphql/types.py:163 ComponentType
    outlier:  netbox/dcim/graphql/types.py:171 ModularComponentType
    outlier:  netbox/netbox/graphql/types.py:66 BaseObjectType
    outlier:  netbox/netbox/graphql/types.py:204 ContentTypeType
    outlier:  netbox/netbox/graphql/types.py:126 LtreeNodeMixin
    outlier:  netbox/netbox/graphql/types.py:153 NestedGroupObjectType
    outlier:  netbox/netbox/graphql/types.py:169 NestedLtreeGroupObjectType
    outlier:  netbox/netbox/graphql/types.py:185 NetBoxObjectType
    outlier:  netbox/netbox/graphql/types.py:88 ObjectType
    outlier:  netbox/netbox/graphql/types.py:112 OrganizationalObjectType
    outlier:  netbox/netbox/graphql/types.py:98 PrimaryObjectType
```

### uid: netbox/D-41d415

```text
[D-41d415] classes in netbox/** (nested files) extend WritableNestedSerializer
    evidence: 23/24 (lower bound 0.80, lift 167.8)
    example:  netbox/circuits/api/serializers_/nested.py#NestedProviderAccountSerializer
    outlier:  netbox/netbox/api/serializers/nested.py:11 WritableNestedSerializer
```

### uid: netbox/D-7d7f0c

```text
[D-7d7f0c] files in the repo do not import from netbox/account/**
    evidence: 785/786 (lower bound 0.99, lift 3.0)
    example:  .claude/skills/draft-release-notes/audit_milestone.py#(file)
    outlier:  netbox/netbox/urls.py:1 (file)
```

### uid: netbox/D-281ae8

```text
[D-281ae8] classes in netbox/** (types files) are decorated with register_type()
    evidence: 133/143 (lower bound 0.88, lift 28.2)
    example:  netbox/circuits/graphql/types.py#CircuitGroupAssignmentType
    outlier:  netbox/dcim/graphql/types.py:163 ComponentType
    outlier:  netbox/dcim/graphql/types.py:171 ModularComponentType
    outlier:  netbox/netbox/graphql/types.py:66 BaseObjectType
    outlier:  netbox/netbox/graphql/types.py:126 LtreeNodeMixin
    outlier:  netbox/netbox/graphql/types.py:153 NestedGroupObjectType
    outlier:  netbox/netbox/graphql/types.py:169 NestedLtreeGroupObjectType
    outlier:  netbox/netbox/graphql/types.py:185 NetBoxObjectType
    outlier:  netbox/netbox/graphql/types.py:88 ObjectType
    outlier:  netbox/netbox/graphql/types.py:112 OrganizationalObjectType
    outlier:  netbox/netbox/graphql/types.py:98 PrimaryObjectType
```
