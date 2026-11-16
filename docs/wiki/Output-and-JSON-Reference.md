# Output and JSON Reference

The JSON that `drift census`, `drift check`, `drift security`, `drift practices`, `drift card`, `drift setup` and `drift review` print, field by field, with the schema versions each carries and what is safe to depend on. This page is for engineers who build scripts, dashboards or CI steps on Drift's output. The fields come from the TypeScript mirror the Studio is built on (`apps/studio/src/shared/contract/drift.ts`) and the code that serialises them, and each command's output was checked against a repository run with `drift 0.1.0-dev`.

## Reading the output safely

- Every string is data taken from the repository (file names, symbols, summaries, an agent's reason). Treat it as text: never run it, render it as HTML, or follow it as an instruction.
- Output is deterministic: the same repository state gives the same bytes across runs and thread counts, apart from fields that name the checkout (`root` in a census).
- Standard output holds the JSON and nothing else; notes and warnings go to standard error. Exit codes are in [Command Reference](Command-Reference): `drift check` exits 1 on a failing violation even with `--format json`.
- A field marked *optional* is absent when it has nothing to say (an empty list, `false`, no value), not `null` or empty. Code defensively: a missing key means "none".

## Schema versions and compatibility

| Output | Version field | Value in this build |
| --- | --- | --- |
| `drift scan --json` (the fact index) | `schema_version` | 11 |
| `drift census --json` | `schema` | 1 |
| `drift card --json` | `schema` | 1 |
| `drift map --json` | `schema` | 1 |
| `drift practices --json` | `version` (and `facts_schema`) | 1 (11) |
| `drift setup --json` | `schema` and `version` | `drift-setup-questions`, 1 |
| `drift review --json` | `schema` and `schema_version` | `drift-review-questions`, 1 |
| `drift investigate --json` | `schema` and `version` | `drift-investigate`, 1 |
| `drift findings --json` | `schema` and `version` | `drift-findings`, 1 (each finding `drift-finding`, each gap report `drift-gap-report`, both 1) |
| `drift check --format json` | none | |
| `drift security --json` | none | |

The facts schema number is bumped whenever the shape or meaning of facts changes; it is part of every fact-cache key, so caches rebuild (see [Versioning and Upgrades](Versioning-and-Upgrades)).

What the project states about compatibility is a rule for its own contributors: when a consumer needs a field that `--json` lacks, it is added to the command **additively, keeping existing fields byte-compatible, with a test** (`CONTRIBUTING.md`). In the Studio's contract file, fields added later are marked "newer drift" and are optional. In practice:

- Fields are added over time, so ignore keys you do not know.
- Enumerated values (a reason, a kind, an obligation) can gain members: treat an unknown value as unknown and show the accompanying text.
- The facts schema number changes whenever the shape or meaning of facts changes. For the other outputs no rule beyond the additive one above is stated. The Studio accepts facts schemas 4 to 11, census schema 1 and practices version 1.
- `drift 0.1.0-dev` is a pre-release; no longer-term compatibility promise is published. If a script must not break, pin the Drift version.

The wording of `none` (authentication, authorization) and `internal` (exposure) is "nothing found in what Drift read". The JSON keeps the value `none` and adds `basis` and `exposure_basis` (below), and authentication that identifies the caller and turns no one away is the state `identified`. Both are additive: fields are expected to be added, so read the release notes of the version you upgrade to.

### `basis`: what a `none` or `internal` rests on

`basis` is on a `none` unit of authentication or authorization (`drift practices --json --units`), and on an inventory row with no guard found (`drift security --json`); `exposure_basis` is on an `internal` row. Both have one shape:

| Field | Type | Meaning |
| --- | --- | --- |
| `bodies` | integer | The bodies read for the answer: the handler's own and those followed. |
| `followed` | list of text (optional) | The repository's functions and methods followed from the entry point, by canonical name, sorted. Absent when empty. |
| `descriptions` | list of text (optional) | The deployment descriptions read for an exposure (a compose file, `.drift/config.yaml`), sorted. Absent when empty. |
| `not_read` | list | What Drift saw and did not read, sorted: `{kind, what, why}`. Empty when it can list nothing, which proves nothing either. |

`kind` is one of `package_function` (a package's function no list of Drift's has an entry for), `depth_limit` (a body of the repository past the depth the reading follows), `not_modelled` (a construct the facts mark and do not model), `description` (a deployment description recognised and not read, or left out by a person) and `file` (a file Drift saw and did not read or classify). `what` is the canonical reference, the file or the construct; `why` is the reason in words. A `none` variant of `drift practices --json` carries the union of its members' `not_read`. The words on every surface come from one place (`crates/drift-mine/src/practices/basis.rs`).

## `drift census --json`

The conventions Drift would propose. Writes no files.

| Field | Type | Meaning |
| --- | --- | --- |
| `schema` | integer | 1. |
| `engine` | text | `drift 0.1.0-dev`. |
| `commit` | text or null | The build's commit, when the build records one. |
| `root` | text | The repository root. |
| `units`, `roles` | integers | Symbols considered and roles formed. |
| `conventions` | integer | Proposals made. |
| `shown` | integer (optional) | Proposals listed (with `--tier`, fewer than `conventions`). |
| `tiers` | `{default, suggestion}` (optional) | Counts per tier. |
| `suggestion_cap` | `{cap, from, suggestions, listed}` (optional) | How many suggestions human views list: `cap` is a number or null for all; `from` is `default`, `conventions.yaml`, `flag` or `all`. |
| `params` | mapping | The mining parameters: `max`, `max_per_role`, `min_role_size`, `min_block_role_size`, `min_lower_bound`, `min_lift`, `min_lift_external_call`, the `tier` definition, and the `show` policy (provenance only). |
| `proposals` | list | One object per proposal, below. |
| `agents` | `{hidden, candidates?, admission}` (optional) | How many proposals agents are not shown (`candidates`: how many of them are default-tier block candidates), and the admission table's source. |
| `withheld` | `{total, by, review}` | Cards mining found and withheld by the show policy: `by` lists `{language, family, reason, n}`; `review` is the command that lists them (`drift review --hidden`). |
| `largest_role` | object or null | With no proposals, the largest role Drift saw. |
| `python_proposals` | object (optional) | Present only while a person turned Python proposals off: how many were not made. |
| `wiring` | object (optional) | Present only while the experimental `wiring` feature is on. |
| `workspace` | object (optional) | Present only in a repository of several packages: `tools` and per-package rows. |
| `unchecked` | list of paths (optional) | Files not parsed for lack of stack, left out of every count. |

### `drift census --why --json`

What mining dropped, gate by gate. Observation only: the proposals are exactly those of `drift census`, and nothing listed is proposed, checked or shown to agents. With a gate named (`drift census --why wilson --json`), `gates` and `dropped` hold only that gate.

| Field | Type | Meaning |
| --- | --- | --- |
| `schema` | integer | 1. |
| `observation_only` | boolean | Always `true`. |
| `gate` | text or null | The gate named, or null. |
| `reached` | mapping | How many reached each stage: `roles`, `role_mined` (roles with 8 or more members across files), `observed`, `drafted`, `mined`, `proposed`. |
| `gates` | list | Every gate in the order mining applies it: `name`, `constant` (the threshold as the code holds it), `passes` (what passes, in words), `origin`, `source` (where that origin is written down), `dropped` (how many). |
| `dropped` | list | Every dropped candidate rule, below. |

`origin` is one of `study` (set by a measured study), `pre-registered`, `engineering, no study`, and `engineering, rationale written but not measured`. A dropped row: `gate`, `id` (the id the convention would have had), `role`, `rule` (the rule in words), `family`, `lang`, `holders`, `members`, `value` and `threshold` (the measured value and the bar it missed, where the gate has numbers), `detail`, `target` (`repository`, `dependency`, `built_in`, `unresolved`, `mixed` or `none`: where the rule's target is defined) and `default_tier` (whether the rule would have been in the default tier).

A proposal:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | text | `D-` and six hex digits. |
| `rank` | integer | Position in the human views: the default tier first, then suggestions, best first. |
| `shown_by_default` | boolean (optional) | `false` for a suggestion past `suggestion_cap`: listed only with `--all`. The cap never hides it from `check` or agents. |
| `summary` | text | The convention in words. |
| `role` | mapping | The role selector (`package`, `dir`, `file`, `entry`, `kind`, ...) with `members`. |
| `rule` | mapping | `type` and its fields; see [Configuration Reference](Configuration-Reference). |
| `evidence` | mapping | `holders`, `total`, `lower_bound`, `lift`; optionally `split`, `role_members`, `python_members`. |
| `tier` | `default` or `suggestion` | |
| `rule_kind` | text | `wrapped_by:call`, `avoids:import` and so on: what the tier is keyed on. |
| `tier_reason` | text or null | Why a suggestion is one: `language_advise`, `rule_kind_d7`, `rule_kind`, `names_package`, `small_role`; null in the default tier. |
| `language` | `ts` or `py` | The language the tier reads (`py` when any member is Python). |
| `names_package` | boolean | The rule names a symbol of a package rather than of the repository. |
| `agents` | mapping | Whether agents are shown it: `shown_to_agents`, `reason` (`default_tier`, `candidate`, `admitted`, `verified`, `person`, `blocks`, `below_bar`, `unknown_family`, `no_table`), `source`, `family`, `accepted`, `n`, `text`. |
| `blockable` | boolean | Whether it may be set to block without `--force`. |
| `example` | `{path, symbol, line}` | A member to copy. |
| `outliers`, `outliers_total` | list, integer | Members that do not follow the rule (all of them in JSON). |
| `exempt`, `inherited`, `derived`, `unchecked_members`, `key_type`, `wiring` | optional | Members the rule is not about with Drift's reason (and a machine-readable `code`); holders that hold it through an in-repo base; holders wrapped in a binding built on the rule's wrapper; members whose verdict may change once an unparsed file is parsed; for `passes_key` rules what the callee's declared parameter type says; wiring details. |

## `drift check --format json`

New violations of accepted conventions, with the conventions as checked.

| Field | Type | Meaning |
| --- | --- | --- |
| `violations` | list | Every violation, including baselined ones; below. |
| `fixed` | list of text | `drift.lock` entries whose violation no longer exists (fixed), safe to prune. Entries in unchecked files and their dependents are never listed: their violations are unknown. For a promoted practice: a unit that now follows it or is gone, never one of a stale practice or one the map cannot tell, and none when the check is limited to named files. |
| `conventions` | list | Each convention as checked; below. |
| `practices` | `{departures}` (optional) | What the practice map says of the files looked at: facts, never a violation, never part of the exit code. Omitted when nothing departs. |
| `diff` | mapping (optional, with `--diff-base`) | `base`, `merge_base`, `files_added`, `files_changed`, `files_renamed`, `files_deleted`, `base_checked` (the merge base was checked too), `policy_changed` (the change edits the policy: every new violation counts as introduced), `new_outside_diff`, and `base_unchecked` (optional). |
| `unchecked` | list of paths (optional) | Files not checked: no stack large enough to parse them could be reserved, so their violations are unknown, not absent. |
| `exempt` | list (optional) | Members an accepted convention is not about, with `id`, `path`, `symbol`, `line`, `reason` and `code`. |
| `suppressed_neighbour` | list (optional) | Warnings the neighbour gate held back (only with `DRIFT_NEIGHBOUR_GATE=on`). |
| `standing` | list (optional) | Per accepted mined rule, what the check read of its members; below. Omitted when there are none. |
| `security` | mapping (optional) | What the security baseline (`.drift/security.lock`) does not hold; below. Omitted when the repository has no baseline, and when files are named. |
| `security_advice` | list (optional, with `--diff-base`) | With no security baseline: what the change adds that a baseline would hold, as advice: `kind` (`no-guard`, `unguarded-reaching` or `unscoped-key`), `key`, `at` (`path:line`), `read` (what Drift read), `reaches` (optional: the operations fed by the request it reaches). Never part of the exit code. |
| `stale_practices` | list (optional) | Promoted practices none of whose ways any unit of their place uses any more: `id`, `summary`, `units` (the units of the concern in the place now). They fire on nothing and never fail the check. Omitted when there are none. |
| `practices_not_checked` | list (optional) | Per promoted practice, the units of its place the practice map cannot tell: `id`, `units`. Never reported, never fail the check. Omitted when there are none. |

A standing (under `standing`):

| Field | Meaning |
| --- | --- |
| `id` | The convention. |
| `whole` | Whether the counts are of the whole repository. A check of named files counts the members they hold only, and staleness is then not decided. |
| `role` | Units in its role now, exempt ones included. |
| `members` | Members the rule is about: those that follow it, those that break it and those not checked. |
| `holders` | Members that follow it. |
| `not_checked` | Members Drift could not tell: never reported, and their `drift.lock` lines stay. |
| `not_checked_why` | Optional: each reason in words, with how many members. |
| `stale` | Optional: why the rule is stale. It then advises until a person looks. |
| `mode` | `block` or `advise`: the mode it is checked with now. |
| `mode_note` | Optional: `was block, now advise because ...` when that mode is not the one in the file. |

The security part (under `security`): `added` (found now and not in the baseline, of a kind the baseline sets to fail, by kind: each `{key, at}`; these fail the check), `advised` (the same, of a kind that only advises), `new_in_drift` (of a kind newer than the inventory that wrote the baseline: not the change's finding), `outside_change` (with `--diff-base`: entry points lacking a shared guard in files the change did not touch), `gone` (`{kind, key}`: in the baseline and no longer found) and `kept` (how many baseline findings are still found). The four maps are omitted when empty. See [Security Inventory](Security-Inventory).

A violation:

| Field | Type | Meaning |
| --- | --- | --- |
| `id`, `path`, `symbol`, `line` | | The convention and the member. |
| `summary`, `evidence`, `example` | text | The rule, `holders/total`, and a member to copy. |
| `mode` | `advise` or `block` | The effective mode: `advise` for roles too small to block, and for a stale mined rule, whatever the file says. |
| `tier` | `default` or `suggestion` (optional) | |
| `baselined` | boolean | In `drift.lock`: legacy, never fails. |
| `suppressed` | boolean | Suppressed by a `drift-ignore` comment with a reason. |
| `unsure` | boolean (optional) | Its file depends on a file not parsed for lack of stack; never new, never blocks. |
| `wire`, `import`, `suppressed_neighbour` | optional | Wiring violations (where the fix goes), the import a layering violation is about, and the neighbour gate. |

A new violation is one with `baselined` false and `suppressed` false. It fails the check when `mode` is `block` (or with `--strict`). A violation of a promoted practice has the same fields and the same meaning.

A convention as checked:

| Field | Meaning |
| --- | --- |
| `id`, `status`, `mode` | As in `.drift/conventions.yaml`. |
| `effective_mode` | As checked once accepted: a role that had under 15 members when it was mined advises even when `mode` is `block`, and so does a practice promoted below the 80% share (`--force`), an experimental wiring rule, and a mined rule gone stale. |
| `tier`, `tier_reason`, `language`, `names_package`, `rule_kind`, `members`, `blockable` | As in a census proposal. |
| `agents` | Whether agents are shown it, with a person's `agents: show` and a forced block taken into account. |
| `verify` | Only with `agents.verify: on`: the experimental verifier's standing. |

A practice departure (under `practices.departures`): `concern`, `unit`, `path`, `package`, `dir`, `variant` and `label` (what `held` of the `others` units around it do), `example`, and `units` (each with `line`, `symbol`, `variant`, `does`).

## `drift security --json`

The full inventory. `FILES` does not filter it.

| Field | Type | Meaning |
| --- | --- | --- |
| `entry_points` | list | One row per entry point; below. |
| `guard_gaps` | list (optional) | A guard at least 90% of the entry points of one kind in one place share, and the members lacking it: `package`, `kind`, `dir`, `guard`, `members`, `with_guard`, `exceptions` (entry points, sorted by path), `example`, and `convention` (`{id, status, mode}`, when a convention says the same). Facts, not rules. |
| `boundaries` | `{rules, warnings?, unread?}` | The deployment boundary read from `.drift/config.yaml` (`security:`) and compose files: `rules` are `{dir, exposure, source}`; `warnings` are files that could not be read and what of a gateway was not read; `unread` lists deployment descriptions Drift recognises and does not read (Terraform, Kubernetes, Helm, ...) by kind, with the first five files and the count. |
| `sinks` | list | Risky operations: `{kind, path, symbol, line}`. |
| `client_leaks` | list | Client files reaching server-only code or secrets: `{reaches, clients, example}`. |
| `env` | mapping | Environment variable to the files that read it. |
| `left_out` | `{files, dirs}` | Non-production files (examples, samples, demos, playgrounds, integration-test suites) the inventory leaves out, so leaving them out is never silent. |
| `unchecked` | list of paths (optional) | Files not parsed for lack of stack: their entry points, risky operations and env reads are unknown. |
| `skipped` | list of `{path, reason}` (optional) | Source files that were not read (too large, a line too long, nested too deep, not UTF-8). |
| `unlisted` | list of `{path, line, symbol?}` (optional) | Places that look served and are in no row of `entry_points`: a registration written as a route is, or (with `symbol`) a function that reads a request and answers it that no listed entry point reaches. |
| `scope_gaps` | list of `{resource, key, members, scoped, exceptions[], example}` (optional) | What most entry points that query one thing filter by a value of the caller, and the entry points that query it and filter it by none. |
| `sinks[].fed`, `entry_points[].reaches[].fed` | boolean (optional) | The operation is given a value read off a parameter of its function, handed on by each call on the way: what the request sent may reach it. Absent when false. |
| `warnings` | list of text (optional) | What could not be read around the inventory, such as a `.drift/conventions.yaml` that does not parse. |

An entry point row:

| Field | Type | Meaning |
| --- | --- | --- |
| `path`, `package`, `symbol`, `line` | | Where it is (`package` is `""` for the root package). |
| `kind` | text | `http`, `page`, `server_action`, `rpc`, `job`, `cron`, `consumer`, `cli`, ... |
| `method`, `route` | text or null | `GET` and `/api/orders`, where it has them. |
| `guards` | list | Wrappers and decorators that reject callers, outermost first; ` (settings)` and ` (app hook)` mark guards applied by configuration or app-wide hooks. |
| `wrappers` | list (optional) | Other call wrappers and decorators: they wrap the entry point but turn no caller away. |
| `authenticates` | list (optional) | Authentication that identifies the caller but rejects nothing: the practice map's `identified` state, by the same instruments. |
| `basis` | object (optional) | Of a row a remote caller reaches with no guard found and nothing that may be one: what "no guard found in what Drift read" rests on (see above). |
| `exposure_basis` | object (optional) | Of an `internal` row: the descriptions read and what was seen and not read. |
| `opens` | list (optional) | Markers that open the entry point to anyone, such as `AllowAny`. |
| `validates` | boolean | Whether input validation was found. |
| `reaches` | list | Risky operations it reaches: `{kind, via}`. |
| `reads` | list | Environment variables it reads. |
| `exposure` | `public`, `internal` or `unknown` (optional) | Where it is reachable from, as far as the repository says. Text output says "internet-facing" for `public`. |
| `boundary` | text (optional) | What says so, for example `compose service api publishes ports`. |
| `descriptions` | list (optional) | What each deployment description says of the route, most exposed first, when more than one describes its service: `{compose, exposure, boundary}`. |
| `tied` | boolean (optional) | The exposure rests on a Terraform tie (`security.terraform`). |
| `local` | boolean (optional) | Its kind is one no remote caller reaches (`cli`): listed, never counted as having no guard. |
| `opaque` | list (optional) | What may be a guard and cannot be read: a wrapper whose definition Drift does not hold, or a call in the body (ending ` (body call)`). An entry point with no `guards` but one of these is not counted as having no guard. |

`none` and `internal` are statements about what Drift read. An entry point with an empty `guards`, no `opaque` and no `opens` has no guard *in what Drift read*; an `exposure` of `internal` rests on proof of the deployment description, and `unknown` is the answer when a description was not read. See [Accuracy and Limits](Accuracy-and-Limits).

### `drift security --diff-base REF --json`

Only what the change since the merge base introduces. Exits 0 whatever it lists.

| Field | Meaning |
| --- | --- |
| `guard_gaps` | Entry points in changed files lacking a guard most of their siblings have, that did not lack it at the merge base: `guard`, `kind`, `package`, `dir`, `members`, `with_guard`, `entry`, `example`, `convention`. |
| `unguarded_reaching` | Entry point rows with no guard reaching a risky operation, not so at the merge base. |
| `added_without_guard` | Entry points the change adds that a request reaches where Drift found no guard in what it read. One whose guard Drift cannot read is not here. |
| `guard_unknown` | Optional: entry points the change adds with no guard and something whose guard cannot be read. Guard unknown, never a finding. |
| `sinks` | Risky operations in changed files that were not at the merge base. |
| `leaks` | Client files newly reaching server-only code or secrets. |
| `now_public` | Entry points that were not internet-facing at the merge base and are now. |
| `diff` | `{base, merge_base, files}`. |
| `warnings` | Optional. |

## `drift practices --json`

What the codebase does for each concern: facts about the code, which nothing checks unless a person promotes a practice. `version` is 1 and `facts_schema` is the facts schema (11).

| Field | Type | Meaning |
| --- | --- | --- |
| `version`, `commit`, `facts_schema` | | |
| `scope` | `{concern, package, path}` | What `--concern`, `--package` and `--path` limited the report to (null when not limited). |
| `summary` | mapping | `population`, `known`, `declared` (of `known`, the units known by a person's word), `none`, `unknown`, `identified` (authentication that identifies the caller and turns no one away; absent when zero), `coverage` (`(known + identified + none) / total`), `concerns_at_target`, `target` (0.9). |
| `concerns` | list | One per concern, in the order `authn`, `authz`, `errors`, `logging`, `api`, `validation`, `config`, `data_access`, `testing`; below. |
| `not_covered` | list of text | What the map does not cover yet. |
| `recipes` | list | The recipe per package and kind of entry point: `id` (`E-` and six hex digits), `package`, `role` (the entry-point kind), `label`, `population`, per-concern variants and a file to copy, and an optional `preview`. |
| `findings` | list | What to look at first, in rank order: `kind` (`unscoped_key`, `unexplained_split`, `none`, `unknown`, `duplicate_helper`), `concern` (or `hygiene`), `package`, `variants`, `members`, `instrument`, `config_hint`, `examples`, and for some kinds `key`, `copies`, `shared_calls`. |
| `consumers` | list (optional) | Message consumers, listed apart and counted in no concern. |

A concern: `id`, `title`, `unit`, `population` (`total`, `known`, `declared`, `none`, `unknown`, `coverage`, `left_out` of tests and non-production), `variants`, `unknown`, `by_package`, `divergence`, `groups` (variants grouped by the instrument they share, optional) and, with `--units`, `units` (every unit with its assignment: `known`, `none` or `unknown`, and the reason). A unit row also carries, each only when set: `kind` (the entry point's kind, such as `http` or `job`), `uses` (the key of each of its known uses, sorted: a unit that does an accepted way and more still follows that way), `enforces` (of a known unit of authentication or authorization: whether one of its uses turns a caller away, or is a check Drift proved) and `unscoped` (of an authorization unit: the tenant or owner key it takes from the request and neither checks nor scopes).

A concern's `population`, and the entries of `recipes[].concerns`, carry an `identified` count when it is not zero. A unit's `assignment` is `known`, `identified`, `none` or `unknown`; a `none` unit has `basis`. A variant: `id` (`P-` and six hex digits), `key`, `label`, `kind` (`known`, `none` or `identified`), `mechanisms`, `instruments`, `source` (`vocab`, `usage` or `declared`), `members`, `share`, `where` (packages, directories, roles, entry kinds, methods), `sets_apart` (at most 3), `examples` (at most 3), `exceptions` (at most 10, the rest in `exceptions_more`), `conventions`, `promotable` (null unless the variant may be promoted now; then `rule` is `"practice"`, `role` is `""` and `place` is the place `drift practices promote` would use, as output names it) and optionally `alternatives`.

`drift practices promote --json` and `drift practices promote --list --json` are documented with the command, on [Command Reference](Command-Reference#drift-practices-promote).

`unknown` is never a variant. It carries `members`, `reasons` (`unparsed`, `opaque_wrapper`, `unresolved`, `no_symbol`, `dynamic`, `body_unreadable`, `not_followed`, `partly_read`, `forwarded`, `signature_not_proven`, `route_not_matched`, `unclassified`, `check_not_proven`), `instruments` (each with the `config_hint` line that would classify it, when one would), `examples`, and optionally `not_proven` and `checks`: a check that was *found and not proven*, with the obligation it fails and one line worded as an unknown. A unit with a found check is never rendered as known.

Two reasons name where the reading stopped. `partly_read`: a function the unit runs was read except for a method of a value whose type Drift does not know; the instrument is that function. `forwarded`: the request is handed on to another service over HTTP; the instrument is the function that hands it on (older versions said `not_followed` with `global#fetch`). `signature_not_proven`: a webhook signature verifier is called, but its failure does not provably leave the handler (swallowed, only logged, under a branch, or its result ignored). In `drift security --json`, a Next.js page under a guarded layout carries the reason `layout_may_redirect` with the layout's file and line, and a webhook that verifies a signature carries `verifies_signature`.

## `drift card <path> --json`

One file's place in the repository: what the text card gives an agent, and every convention covering the file (not only accepted ones).

| Field | Type | Meaning |
| --- | --- | --- |
| `schema` | integer | 1. |
| `path`, `package`, `lang` | | The file, its package, its language (null if not read). |
| `exists`, `not_parsed` | boolean | Whether the file exists; whether it was not parsed. |
| `skipped` | text (optional) | Why a scan skipped the file (`too_large`, `generated`, ...). |
| `entry_points` | list | Entry point rows as in the security inventory. |
| `sinks`, `env_reads`, `client_leaks` | lists | Risky operations, environment reads, and server-only code the file reaches. |
| `siblings` | list | Entry points of one kind sharing the narrowest place (8 or more) with the file, and the guards they carry: `kind`, `dir`, `members`, `guards`, `example`. |
| `conventions` | list | Each covering convention: `id`, `status` (`accepted` or `proposed`), `mode`, `summary`, `holders`, `total`, `example`. |
| `regularities` | list (optional) | Strong regularities of the roles the file is in, as facts and not rules: `id`, `status` (`withheld`, `proposed`, `accepted`), `summary`, `holders`, `total`, `example`, `here`. |
| `unknown` | list of text | What Drift does not know about the file. |

## `drift setup --json`

The open questions, in the order they are asked. Schema `drift-setup-questions`, version 1. With `--all`, answered questions too; with `--evidence`, each question carries `context`.

| Field | Meaning |
| --- | --- |
| `schema`, `version` | `drift-setup-questions`, 1. |
| `config` | The file answers are written to: `.drift/config.yaml`. |
| `questions` | The questions; below. |
| `answered` | Questions answered on the evidence they show now (listed only with `--all`). |
| `waiting` | An agent's answers waiting for a person. |

A question: `id` (`S-` and four hex digits), `kind` (`deployment`, `terraform`, `check`), `status` (`open`, `answered`, `changed`, `proposed`, `rejected`), `answered` and `answered_by` (optional), `proposal` and `rejected` (optional: an agent's answer with `answer`, `label`, `by`, `reason`, `evidence`, `on`, `stale`), `text` (paragraphs), `note` (optional), `question`, `choices`, `default` (`skip`), `command` (`drift setup --answer <id>=<answer>`), `evidence` (a digest), `how_to_decide`, and `context` (optional: `facts`, `excerpts` of `{what, file, line, text}`, `routes`, `omitted`).

A choice: `answer` (what `--answer <id>=` takes), `label`, `effect` (what it does, counted where it moves routes), `writes` and `writes_under` (the line it writes and the key it goes under, optional), `moves` (routes it moves), and `needs_person`: given by an agent, this answer is a proposal until a person confirms it, because it could make a route reachable only from inside, or a check counted.

## `drift investigate --json`

Every route Drift could not settle, grouped by what would settle it. Schema `drift-investigate`, version 1. Changes nothing. With `--evidence` (or `--item ID`), each item carries `context` in the shape of `drift setup --json --evidence`.

| Field | Meaning |
| --- | --- |
| `schema`, `version` | `drift-investigate`, 1. |
| `config` | Where outcomes and proposals are recorded: `.drift/config.yaml`. |
| `items` | The items; below. An agent's proposals waiting for a person first, then by the routes they would settle; with `--all`, every one. |
| `open` | Items with nothing recorded, or recorded on evidence that changed. |
| `waiting` | An agent's proposals waiting for a person. |
| `skipped` | Items an agent skipped with a note. |
| `settled` | Items settled: an outcome recorded on the evidence they show now, a finding or gap report written, or their setup question answered. |
| `routes` | Distinct routes the listed items would settle. |

An item: `id` (`I-` and six hex digits, stable for what the item is about), `kind` (`check`: a check found and not proven; `unread`: an instrument Drift did not read; `nothing_found`: routes Drift says `none` of; `exposure`: routes whose reach is unknown or inside only), `concern` (`authn`, `authz`, `exposure`), `status` (`open`, `changed`, `proposed`, `skipped`, `answered`, `rejected`, `finding`, `gap`), `what`, `not_read` (`{reason, instrument, words}`), `routes` (at most 60, each `{route, handler}`) and `route_count`, `setup` (optional: the `drift setup` question that already asks this, answered there), `outcomes` (each `{outcome, label, needs_person, effect}` and optionally `needs`, the fields it also takes), `how_to_decide`, `command`, `evidence` (a digest of what the item rests on: an outcome is asked again when it changes), and optionally `record` (what was recorded: an outcome, a skip note, an agent's proposal), `finding` (`F-...`), `gap` (`G-...`) and `context`. `needs_person: true` marks a proposal.

## `drift findings --json`

What an agent found while investigating, read from the local files. Schema `drift-findings`, version 1.

| Field | Meaning |
| --- | --- |
| `schema`, `version` | `drift-findings`, 1. |
| `findings` | Each finding, as in `.drift/findings/<id>.json` (schema `drift-finding`, version 1): `id` (`F-` and six hex digits), `item`, `seen`, `title`, `concern`, `drift_said`, `routes`, `why`, `fix`, `excerpts`, `evidence`, `patch` (optional: a unified diff, the diff text itself, never applied), `by` (`agent` or `person`), `on`. |
| `gap_reports` | Each gap report, as in `.drift/gap-reports/<id>/gap.json` (schema `drift-gap-report`, version 1): `id` (`G-` and six hex digits), `item`, `seen`, `drift_said`, `expect`, `why`, `files` (relative to `fixture/`), `says` (what the Drift that wrote it says of the fixture), `drift` (its version), `by`, `on`. |

## `drift review --json`

The one question each block candidate (a proposed default-tier convention) asks. Writes nothing. Schema `drift-review-questions`, version 1 (`schema_version`).

| Field | Meaning |
| --- | --- |
| `schema`, `schema_version` | |
| `question` | `Are these the same kind of thing?` |
| `answers` | The answers and what each does: `same`, `different`, `not-a-convention`. |
| `unanswered` | What an unanswered candidate means: it stays a candidate and no agent is shown it as a convention. |
| `candidates` | One per block candidate: `id`, `summary`, `rule_kind`, `family`, `holders_total`, `members`, `holders` (members that follow it, the example first), `flagged` (the members it would flag, by file, each with `symbol`, `line`, `needs_confirmation` and `legacy`), `flagged_total`, `auth_or_validation`, `set_apart`. |

## `drift scan --json` and `drift map --json`

`drift scan --json` prints the fact index: `schema_version` (11), `files` (one record per file: path, hash, language, package, symbols, imports, entry points, ...), `skipped`, `packages`, and, where present, models and lint settings. `drift facts <file>` prints one file's record. The fact index is the largest and the least stable surface: its fields track what the parsers record, and the number above changes when they do.

`drift map --json` prints `schema` (1), `scope` (`repo` for the overview), `files`, `files_in_a_role`, `test_roles`, `packages` (each with `path`, `name`, `manifest`, `languages`, `files`, `production_files`, `layers`, `entry_points`, `depends_on`, `dependencies_test`, `depended_on_by`, `tests`) and `roles`.

## Other formats

`drift check --format sarif` prints SARIF 2.1.0; `--format github` prints GitHub Actions workflow commands; both are described in [Command Reference](Command-Reference) and [Drift in CI](Drift-in-CI).

See also: [Command Reference](Command-Reference), [Configuration Reference](Configuration-Reference), [Practices Map](Practices-Map), [Security Inventory](Security-Inventory), [Versioning and Upgrades](Versioning-and-Upgrades), [Glossary](Glossary)
