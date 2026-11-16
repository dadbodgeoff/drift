# Configuration Reference

Every setting Drift reads, key by key, with its type, default and effect; the format of `.drift/conventions.yaml` and `drift.lock`; and the environment variables the `drift` binary reads. This page is for the people who configure Drift for a repository and for the engineers who review those changes. The keys below are those the code reads (`crates/drift-mine/src/policy.rs`, `crates/drift-mine/src/workspace.rs`, `crates/drift-cli/src/setup.rs`); a key not listed is not read.

## The three files

| File | Holds | Who writes it |
| --- | --- | --- |
| `.drift/config.yaml` | Settings people choose: experimental features, where entry points are reachable from, packages, the agent brief, declared practices, and the record of `drift setup` answers. Every key is optional. | People, and `drift setup` for the keys it records. |
| `.drift/conventions.yaml` | The conventions Drift mined and what people decided about each: status, mode, exceptions. | `drift init` (proposals), `drift review` and the Studio (decisions). |
| `drift.lock` | Legacy violations that never block, one per line. | `drift init` and `drift review` (baselines); people remove lines by fixing code. |

Commit all three. The cache, session state, the review log and `.drift/verify-cache.json` (the experimental verifier's verdicts) under `.drift/` are local: see [Files Drift Writes](Files-Drift-Writes).

Drift reads each of these only as a regular file. A symbolic link that leaves the repository, a FIFO, or a file that is not UTF-8 is refused with an error, never read as empty, and Drift never writes through a link that leaves the repository.

## `.drift/config.yaml`

The file is YAML. An empty file is the same as no file. A key Drift does not know is a warning on standard error (`drift: .drift/config.yaml: unknown setting 'x' (ignored)`), never an error, so a newer Drift's keys are harmless to an older one. YAML that cannot be parsed, or an `experimental` that is not a list of names, is an error (exit 2). Warnings are printed by `drift census` and `drift init`; `drift practices` prints those about `practices:`.

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| [`experimental`](#experimental) | list of feature names | `[]` | Turns on experimental features. |
| [`proposals`](#proposals) | mapping | Python proposals on | Turns mined proposals off. |
| [`security`](#security) | mapping | no settings | Says where entry points are reachable from and which deployment descriptions deploy nothing. |
| [`packages`](#packages) | mapping | discovery | Overrides which directories are packages and which are mined and checked. |
| [`agents`](#agents) | mapping | `brief: on` | What the agent hooks add on their own. |
| [`practices`](#practices) | mapping of mappings | none | Names instruments the practice map could not classify. |
| [`setup`](#setup) | mapping | none | The record of `drift setup` answers. Written by `drift setup`. |

### `experimental`

A list of feature names. A name Drift does not know is a warning that lists the known ones. The environment variable `DRIFT_EXPERIMENTAL` (comma-separated) adds to this list.

| Feature | Effect |
| --- | --- |
| `wiring` | Mines and checks "registered in" and co-change rules (suggestion tier, advice only, never blocks). With the feature off, wiring conventions in `.drift/conventions.yaml` are not checked, and `drift init` drops them. |
| `intra_package_layering` | Mines and checks layering between areas inside one workspace package. Off by default: on the build set its cards were not accepted under the fold rule. |
| `test_roles` | Forms and mines roles of test code (selector version 4). |
| `kind_roles` | Forms and mines roles of one structural kind across the repository: components, hooks, pydantic models, routers and so on (selector version 4). |
| `listed_entry_points` | Every command reads every entry point Drift lists, where mining and `check` read those of the last measured build: the routes `drift security` and the practice map read (registered in a function, by a file-convention router, by an unpacked `urlpatterns`) become members of the roles conventions are mined for and checked in. `drift census --listed` previews the same without the feature. The precision of what mining proposes over these entry points was not measured. |

```yaml
experimental: [wiring]
```

### `proposals`

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `proposals.python` | `on` or `off` (YAML `true` and `false` are read the same) | `on` | `off` mines no Python proposals, and drops from `.drift/conventions.yaml` any Python proposal an earlier run wrote. What a person decided (accepted, rejected, `agents: show`) is kept and checked as before. Python facts, `drift check`, the security inventory and everything else are unaffected. |

Any other value, a `proposals` that is not a mapping, or another key under it is a warning and leaves the default: only an `off` Drift can read turns Python proposals off.

```yaml
proposals:
  python: off
```

### `security`

Where entry points are reachable from, for `drift security`, `drift card`, the practice map and the hooks. A person's statement wins over what compose files suggest. Directories are repo-relative (a package or any directory); a leading `./` and a trailing `/` are removed, `.` names the whole repository, and `..` is ignored. Each key below takes a list; a value that is not a list of strings is a warning and is ignored.

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `security.internal` | list of directories | `[]` | Entry points under these directories are reachable only from inside the deployment (behind a gateway, a private network, a job runner). Reported as `internal`, with the setting as the source (`internal` in JSON too). |
| `security.public` | list of directories | `[]` | Entry points under these directories are reachable from the internet. Reported as internet-facing in text and `public` in JSON, with the setting as the source. |
| `security.not_deployed` | list of files or directories | `[]` | Deployment descriptions that are in the repository and deploy nothing (a compose file for end-to-end tests, Terraform kept for reference). Drift leaves them out of the boundary, and says so. |
| `security.terraform` | list of `{target, code}` | `[]` | A person's statement that a Terraform target group forwards to the code in `code`, and that requests from outside reach that code, in what this Terraform deploys, only through load-balancer rules that forward to that target. Drift then reads the listener rules of the repository's Terraform for the routes of `code`. |

Between `internal` and `public`, the longest matching directory wins.

Each `security.terraform` entry has exactly two keys:

| Key | Meaning |
| --- | --- |
| `target` | The directory of the Terraform module, repo-relative, optionally followed by `#aws_lb_target_group.<name>` to name one target group. Without a name, every target group of the module. A name must be letters, digits, `_` and `-`. |
| `code` | The code directory, repo-relative; `.` is the whole repository. |

An entry with another key, a missing key, or a `#` that names something other than an `aws_lb_target_group` is a warning and that entry is ignored. An unknown key under `security` is a warning.

```yaml
security:
  internal: [services/billing, jobs]
  public: [apps/web]
  not_deployed:
    - e2e/docker-compose.test.yml
    - infra/legacy
  terraform:
    - {target: "infra/prod#aws_lb_target_group.api", code: services/api}
```

`drift setup` writes `not_deployed`, `terraform` and `internal` entries for you, each with a comment line above it saying which question it answers and when. See [Security Inventory](Security-Inventory) and [Setup Questions](Setup-Questions).

### `packages`

Overrides how Drift finds the packages of a monorepo. Without it, packages are discovered from manifests and workspace files. A `packages` that is not a mapping, a value that is not a list of strings, or a glob that is not valid (or contains `..`) is a warning and that part is ignored. Globs are repo-relative directory globs; `.` names the root package.

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `packages.roots` | list of directory globs | `[]` (discovery) | Replaces discovery: each file belongs to the deepest root that holds it, else to the root package, whatever its manifests say. |
| `packages.exclude` | list of directory globs | `[]` | Packages left out of mining, `drift check`, the hooks and MCP. |
| `packages.include` | list of directory globs | `[]` (all) | When set, only these packages are mined and checked. |

Every scan applies the setting, so mining, `check`, the hooks and MCP all see the same packages.

```yaml
packages:
  roots: [frontend, backend/services/*, backend/packages/*]
  exclude: [backend/services/legacy]
```

### `agents`

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `agents.brief` | `on` or `off` (YAML booleans are read the same) | `on` | The session brief the SessionStart hook opens with: the practices for the package of the session's directory and the packages with their entry points, with `drift card` named as the first stop (at most about 300 tokens). `off` turns the brief off; the count of accepted conventions is still said. |

A value other than `on` or `off` is a warning and the brief stays on. An unknown key under `agents` is a warning. (`agents.verify` is a setting of `.drift/conventions.yaml`, below.)

```yaml
agents:
  brief: off
```

### `practices`

Instruments a person names for a concern of the practice map. It is the first source of their classification: a declared instrument is `known`, counted as declared, rather than `unknown`. The shape is `practices: {<concern>: {<canonical reference>: <label>}}`.

| Part | Meaning |
| --- | --- |
| `<concern>` | One of `authn`, `authz`, `errors`, `logging`, `api`, `validation`, `config`, `data_access`, `testing`. An unknown concern is a warning and is ignored. |
| `<canonical reference>` | The instrument as Drift names it, `path#symbol` (`lib/auth.ts#withAuth`, `svc/app/services.py#RuleBook._ensure_access`). `drift practices --hints` prints the exact lines. |
| `<label>` | Non-empty text naming what it is. An empty or non-text label is a warning and that line is ignored. |

A line is a person's statement that the instrument is what the label says and decides for every request that reaches it. For authorization, it settles a route only where the route runs the named instrument on every path; a check the route reaches only sometimes stays `unknown` whatever is declared. `drift practices` warns about a line that names nothing in the repository.

```yaml
practices:
  authn:
    "lib/auth.ts#withAuth": withAuth
  authz:
    "svc/app/services.py#RuleBook._ensure_access": "RuleBook._ensure_access"
```

### `setup`

The record of what `drift setup` was told, written and read by `drift setup` alone; other commands ignore it. Each answer is one line under `setup:` with a comment above it, and its effect is written under the key it changes (`security.not_deployed`, `security.terraform`, `security.internal`, `practices.<concern>`).

```yaml
security:
  not_deployed:
    # drift setup S-abf5 (2026-11-11), asked whether `docker-compose.yml` is used to deploy: only for tests or local development
    - "docker-compose.yml"

setup:
  # drift setup S-abf5 (2026-11-11), asked whether `docker-compose.yml` is used to deploy: only for tests or local development
  S-abf5: {answer: "tests-only", seen: "8a9252c7"}
```

| Field | Meaning |
| --- | --- |
| `answer` | The answer given (`tests-only`, `tie-1`, `none`, `tenant`, ...). |
| `seen` | A digest of the evidence the answer rested on. A question whose evidence changed is asked again. |
| `by`, `reason`, `evidence`, `on` | For an agent's answer: who gave it, its reason, the `file:line` places it read, and the date. |
| `confirmed_by: person` | A person confirmed an agent's answer. |
| `setup.proposed.<id>`, `setup.rejected.<id>` | An agent's answer waiting for a person, and one a person rejected on the evidence it showed. |

Use `drift setup --forget <id>` to take an answer out, with what it wrote; do not edit the record by hand. Commit the file so teammates get the same answers.

Not built yet: answers in `.drift/config.yaml` that go stale when the evidence they rested on changes (see [Setup Questions](Setup-Questions)). The format above is the present behaviour.

## `.drift/conventions.yaml`

Written by `drift init` and edited by `drift review` and `drift practices promote`. Its header says what it is:

```yaml
# Drift conventions: mined from this codebase, approved by people.
# status: proposed | accepted | rejected    mode: advise | block
# Edit status/mode by hand or with `drift review`. Agents must not edit this file.
version: 1
engine: drift 0.1.0-dev
file_kinds:
  literal_stems:
  - route
  suffixes: []
conventions:
- id: D-e0a68b
  status: accepted
  mode: block
  summary: HTTP handlers in app/api/** (route files) are wrapped in withAuth()
  role:
    package: ""
    dir: app/api
    file: route
    entry: http
    kind: function
  rule:
    type: wrapped_by
    kind: call
    any_of:
    - lib/auth.ts#withAuth
  evidence:
    holders: 38
    total: 39
    lower_bound: 0.868
    lift: 2.308
  example: app/api/alerts/route.ts#GET
  selector_version: 3
```

### Top-level keys

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `version` | integer | 1 | The format. `1`: one package. `2`: adds `packages`, written only for a repository of several packages. A single-package policy is still written as version 1. A file with a version above the one the running Drift knows (2) is refused: `was written by a newer Drift`. |
| `engine` | text | | The Drift that mined it (`drift 0.1.0-dev`). A newer engine re-mines only on `drift init`. |
| `file_kinds` | mapping | | The file-kind vocabulary (`literal_stems`, `suffixes`) frozen when conventions were first mined, so role selectors stay stable. `drift init --refresh-kinds` relearns it. |
| `suggestion_cap` | integer or `all` | 5 | How many suggestions `drift review`, `drift init`, `drift census` and the Studio list by default. Presentation only: `check`, the hooks, MCP and exports read every accepted convention whatever this says. Set by hand; `drift init` keeps it. |
| `agents` | mapping | | `agents.verify: on` lets the host agent verify suggestions (experimental, off by default; see [MCP Reference](MCP-Reference)). Set by hand; `drift init` keeps it. |
| `review_log` | `on` | absent (off) | `drift review` and the Studio record each decision and each card shown in `.drift/review-log/`. Set with `drift review --set-log on\|off`. |
| `packages` | list of directories | absent | Version 2 only: the workspace packages (`""` is the root) the conventions were mined over. Rewritten by `drift init`. |
| `conventions` | list | | The conventions: accepted first, then proposed, then rejected. Accepted and rejected ones are ordered by id, so a run that only refreshes evidence moves no line of what people decided; proposals are ordered by lower bound, strongest first, then by id. |

### A convention

| Key | Type | Meaning |
| --- | --- | --- |
| `id` | text | `D-` and six hex digits. Stable across re-runs of `drift init`. |
| `status` | `accepted`, `proposed`, `rejected` | `proposed` is mined and not yet reviewed and only ever advises; `accepted` is checked; `rejected` is never proposed again. |
| `mode` | `advise`, `block` | Whether a new violation only reports or fails `drift check`. Experimental wiring rules always advise. A role that had fewer than 15 members when it was mined, a practice promoted below the share a block needs, and a mined rule gone stale advise whatever the file says; `drift check` says why. |
| `summary` | text | Human summary, regenerated on each `drift init`. |
| `role` | mapping | The selector for the members the convention is about: `package`, `dir`, `file`, `entry`, `kind`, and optionally `variety`, `export_name`, `member_kind`, `shape`, `also` (sibling roles of a merged card). Frozen once written. |
| `rule` | mapping | `type` and its fields (below). |
| `evidence` | mapping | `holders` of `total` members follow the rule; `lower_bound` (Wilson) and `lift`; optionally `split` (for variant sets, `[alternative, members]`), `role_members` and `python_members`. Refreshed on each `drift init`. |
| `example` | text | `path#symbol` to copy from. |
| `selector_version` | integer | How the role selector is read: absent means 1; 2 and 3 as new kinds of role arrived; 4 for test and kind roles. Drift keeps it as written. |
| `agents` | `show` | A person's decision to show the convention to agents whatever its family's track record. Set by `drift review --show-to-agents`. |
| `exceptions` | list of `{member, reason}` | Outliers a reviewer marked as legitimate. `member` is `path#symbol`; `reason` is one line of at most 120 characters. `drift check` lists such a member as exempt (code `reviewed`). |
| `different_kind` | list of `{path, entry_points}` | Files a person set apart as a different kind of thing (`drift review --answer ID=different --set-apart PATH`). `entry_points` lists entry points under an authentication or validation rule that the person confirmed one by one. |
| `promoted_from_hidden` | `true` | The card was promoted by a person from the ones mining withheld. Absent when false. |
| `accepted_evidence` | mapping | The evidence as it stood when a person accepted the convention: `role_size`, `holders`, `total`, `lower_bound`. Written the first time `drift init` meets the convention accepted, and moved with the decision when the id changes. `evidence` is rewritten on every run; this is not. Absent until then. |
| `promoted_from_practice` | text | The practice-map variant (`P-` and six hex digits) a person promoted this convention from with `drift practices promote`. Absent for a mined convention. Its place is the role's `package` and `dir`. |

Rule types: `wrapped_by` (`kind`, `any_of`), `passes_key` (`callee`, `index`, `key`), `calls` (`callee`), `renders` (`component`), `directive` (`value`), `control` (`value`), `throws` (`class`), `named` (`pattern`), `before` (`first`, `then`), `avoids` (`signal`), `has_test`, `prefers_library` (`group`, `preferred`), `model_has` (`field`), `package_has` (`item`), `dependency_version` (`name`, optional `range`), `imports_from` (`name`, `source`, `instead_of`), `practice` (`concern`, `any_of`: the practice-map variant keys accepted as ways, such as `wrap:lib/auth.ts#withAuth`; optionally `any_mechanism`, mechanisms accepted whole, and `any_enforcing: true`, any way that enforces sign-in or permissions, both absent unless set; written only by promoting a practice, and checked by the practice map's classifier; see [Practices Map](Practices-Map#how-the-rule-is-checked)), and the experimental `registered_in` and `mirrors_keys`. A Drift from before promotion cannot read a file that holds a `practice` rule ([Versioning and Upgrades](Versioning-and-Upgrades#promoted-practices-and-older-drift)).

Edit `status` and `mode` by hand or with `drift review`; agents must not (the hooks deny writes under `.drift/`). Only `drift.lock` has a recommended merge setting (below). A conflict in this file is an ordinary YAML conflict: keep each side's decisions and run `drift check` afterwards.

## `drift.lock`

Baselined violations: legacy violations that never fail `drift check`. One line each, sorted: `<convention id> <path#symbol>`, and below it a fingerprint line `#~ <convention id> <16 hex digits> <path#symbol>` that lets the entry follow the member when it moves (see [Files Drift Writes](Files-Drift-Writes#driftlock)). Blank lines and other lines starting with `#` are ignored.

```text
# drift.lock: legacy violations that never block. Fix code to remove lines.
D-e0a68b app/api/events/route.ts#GET
#~ D-e0a68b <16 hex digits> app/api/events/route.ts#GET
```

`drift init` baselines the current violations on the first run and, on later runs, only the current violations of conventions new to the policy. An existing convention is never baselined again. Existing entries are kept and gain a fingerprint line; when a rule gains an alternative and comes back as a proposal under a new id, the old id's lines are copied to it. A convention the lock already has lines for is not baselined again when it comes back to the policy. `drift practices promote` adds one line per unit that differs from the promoted practice today. People add lines; fixing the code removes them. Because each line stands alone and the file is sorted, adding `drift.lock merge=union` to `.gitattributes` lets parallel branches merge it without conflicts:

```bash
echo "drift.lock merge=union" >> .gitattributes
```

## Environment variables

| Variable | Read by | Effect |
| --- | --- | --- |
| `DRIFT_CACHE_DIR` | every command | Directory for the fact cache, instead of `.drift/cache` (when set, it is used as given). Commands that otherwise write nothing (`map`, `practices`, `setup`, `census --json`, `census --coverage`) use the cache only where this points. The GitHub Action sets it to a fresh directory outside the checkout. |
| `DRIFT_EXPERIMENTAL` | every command that mines or checks | Comma-separated experimental features, added to `experimental` in `.drift/config.yaml`. |
| `DRIFT_NEIGHBOUR_GATE` | `check`, the hooks, MCP | `on` or `off`. The neighbour gate, which holds back a new violation that sits nearer the members its convention sets apart than its holders, is off by default; `on` turns it on. |
| `DRIFT_HOOK_TRACE` | `hook` | A file path. Each hook appends one JSON line: `event`, `path` (`single_file`, `full_scan:<reason>`, `skipped:<reason>` or `none`), `answered`, `ms` and `work` (counts of walks, source reads, parses, full and one-file scans, config and policy loads). Off when unset; it changes no behaviour. |
| `DRIFT_REVIEW_VIA` | `review` | `studio`, set by the Studio so the review log says where a decision was made. Anything else, or nothing, is the command line. |
| `GITHUB_STEP_SUMMARY` | `check --format github`, `security --diff-base --github` | A file path set by GitHub Actions; when set, a Markdown job summary is appended to it. |
| `CLAUDE_CODE_SESSION_ID` | `mcp` | Set by Claude Code for the servers it starts. Lets MCP tools know which rules the session was already given. |
| `HOME` | `hook` | For a repository with no `.drift/conventions.yaml`, the SessionStart brief is not built when the repository root is the home directory. |

For Drift's own development and studies, a few more variables exist and are not part of the supported interface: `DRIFT_FUNNEL` and `DRIFT_STUDY_NEIGHBOUR` (study output files), and `DRIFT_TEST_UNSHOWN` (debug builds only; release builds do not read it).

Drift runs `git` (for `git ls-files`, `git diff`, `git merge-base`, `git rev-parse` and, for the experimental co-change rules, history) where it needs it; a missing `git` makes `--diff-base` an error and is otherwise tolerated. It does not read a global git configuration or `.git/info/exclude` when deciding which files to scan, so results do not depend on the machine; it does read each directory's `.gitignore` and `.ignore`.

See also: [Command Reference](Command-Reference), [Files Drift Writes](Files-Drift-Writes), [Security Inventory](Security-Inventory), [Practices Map](Practices-Map), [Setup Questions](Setup-Questions), [Versioning and Upgrades](Versioning-and-Upgrades), [Glossary](Glossary)
