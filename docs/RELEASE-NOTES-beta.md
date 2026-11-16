# Drift beta: release notes (draft)

> **Draft. Not published.** The version number, the date and the repository
> these notes are published from are open: see
> [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md). Nothing is published without the
> owner's explicit go-ahead. The main branch carries `0.1.0-dev`; a beta tag such
> as `v0.1.0-beta.1` would be published to npm under the `next` dist-tag, not
> `latest` ([RELEASING.md](../RELEASING.md)).

Drift learns the conventions a TypeScript, JavaScript or Python codebase
already follows, shows them to you with their evidence, and tells coding agents
about the ones you accept. It ships no predefined rules, runs no AI in the
check path, and sends no code anywhere.

**This beta in five lines:**

1. Conventions are mined from your code and **shown to people first**.
2. Default-tier conventions (**block candidates**) reach agents **only once a
   person accepts them** (decision D13).
3. Suggestions are shown only when they pass the **round-10 show policy**, and
   no suggestion family is shown to agents.
4. **Python mined proposals are on by default, as suggestions only**; turn them
   off with `proposals: {python: off}` (decision D13-py).
5. **Nothing blocks** unless a person sets it to block.

How accurate it is, in and out of sample: [ACCURACY.md](ACCURACY.md).

## What is new

### Block candidates: agents see only what a person accepted (D13)

- A default-tier proposal (a TypeScript/JavaScript call wrapper or layering
  rule, in a role of 15 or more members, whose target the repository defines)
  is a **block candidate** until a person accepts it.
- `drift census`, `drift init`, `drift review` and the Studio list block
  candidates first, marked `agents: not shown to agents (block candidate:
  reaches agents once you accept it)`. `census --json` gives
  `agents.reason: "candidate"` and counts them in `agents.candidates` (absent
  when there are none).
- No agent surface has a block candidate: not the Claude Code hooks, the MCP
  tools, `drift example`, the `drift check` text report or the AGENTS.md
  export. It reaches them after `drift review --accept <id>` (or `y` or `b` in
  interactive review, or the Studio), or `agents: show`.
- Anything ambiguous reaches no agent: a status other than `accepted`, or a
  `.drift/conventions.yaml` Drift cannot read.
- **Blocking is unchanged:** it still needs an accept in block mode.
- **Why:** out of sample, about half of the default tier was right (7 of 15
  cards, PLAN-R11 §1). The tier stays as defined by decision D7 and is shown to
  people first; only the unvetted exposure to agents is removed.
- **What it costs:** in a repository nobody has reviewed, agents are told no
  convention at all.

### Python mined proposals on by default, as suggestions (D13-py)

- Drift makes mined Python proposals unless a person turns them off:

  ```yaml
  # .drift/config.yaml
  proposals:
    python: off
  ```

  Every Python proposal is a suggestion (decision D7): none blocks unless a
  person forces it, and no Python family is shown to agents.
- While they are off, `drift census` and `drift init` say how many Python
  proposals they did not make (`census --json`: `python_proposals.withheld`).
  Python conventions a person accepted or wrote are still checked, and
  `drift security` still lists Python entry points.
- Only `off` (or `false`) turns them off. Any other value is ignored, with a
  warning, and leaves them on.
- `drift census --python-proposals` makes them for one census whatever the
  config says, and writes nothing.
- **Why:** round 11 turned them off because their only blind estimate was two
  cards, and fixed what would turn them back on: a blind pool of at least 10
  shown Python cards, at least 70% not wrong and within 10 points of the
  in-sample figure (PLAN-R11 §3). The pre-registered check passed: 11 cards
  shown on 30 blind repositories, 10 accepted, 1 trivial, none wrong
  ([dev5-check.md](../eval/study/runs/dev5-py/dev5-check.md)).
- **What it does not show:** eleven cards is one above the minimum, the wrapper
  family had no out-of-sample card, and a held-out pass is still needed before
  any Python accuracy claim.

### The round-10 show policy: fewer, better suggestions

- A suggestion is shown at all only when it has **at most one outlier** and its
  **rule family is admitted for its language** by a leave-one-repo-out table:
  60% accepted on the other dev repositories, with at least 5 labelled cards
  (`crates/drift-mine/data/show-policy.json`, PLAN-R10 §4).
- Call order is hidden in both languages; TypeScript rendered components and
  calls, and Python package and repository facts, are hidden as well.
- A hidden card is not proposed: `census` (`--all` included), `init`, `review`,
  `check`, the hooks, MCP and the Studio never list it. The default tier is not
  affected.
- The table is frozen in the binary and is not regenerated in round 11.

### New: `drift investigate` and `drift findings`

- `drift investigate` lists every route Drift could not settle (authentication or
  authorization `unknown` or `none`, reach `unknown` or `internal`), grouped by
  what would settle it, with the evidence to read (`--json`, schema
  `drift-investigate` version 1; `--agent-brief` prints the instructions an agent
  follows). `--record ID=OUTCOME` and `--answers FILE` record outcomes.
- Outcomes follow the trust rule of `drift setup`. `guard:<file>#<symbol>`,
  `check:<tenant|owner|role>:<file>#<symbol>` and `internal` are proposals that
  wait for a person in `drift setup --review`. `not-a-guard`, `not-a-check`,
  `reachable` and a skip note take effect, and an unknown never becomes `none`.
  A finding goes to `.drift/findings/` and a gap report (a minimal example of a
  construct Drift does not read, with the repository's names replaced) to
  `.drift/gap-reports/`: both local, git-ignored by their own `.gitignore`, and
  never posted or sent.
- `drift findings` lists them (`--json`, schema `drift-findings` version 1).
  On a person's request, `--issue ID` prints an issue draft (nothing is
  posted) and `--branch ID` makes a local branch `drift/<id>` with the agent's
  patch, through a throwaway index: `HEAD`, the index and the working tree are
  not touched and nothing is pushed.
- In an `--answers` file a finding's `patch` is the diff text itself; the
  command-line `--patch` takes a file.
- `drift mcp` serves 12 tools: ten that only read, and `drift_setup_answer` and
  `drift_investigate_record`, which write. The new ones are
  `drift_investigate_items` (reads) and `drift_investigate_record` (writes).

### New: promote a practice to a convention

- `drift practices promote <P-id> [--in <path>]` makes one practice of the
  practice map the rule for new code in a place (a package or a directory of
  one). It writes one accepted convention of the new rule type `practice`, in
  advise mode and shown to agents (`agents: show`, `promoted_from_practice`),
  and one `drift.lock` line per unit that differs today, so only new code is
  reported. `--dry-run` prints the preview and writes nothing; `--list` lists
  what qualifies; `--json` gives the result as JSON.
- The rule is checked by the practice map's classifier, by variant key, not by
  name. A unit the map cannot tell is never reported; `drift check` counts it as
  not checked. A promoted practice none of whose ways is used any more is
  reported as stale and fires on nothing.
- It qualifies from counts only: at least 8 readable units of the concern in the
  place, the accepted ways at least 80% of them, at most 20% of the place
  unknown. `--with` adds a further way (a way that marks a route open on purpose
  is never added unless a person names it); `--force` promotes below 80%, in
  advise mode only.
- `--block` is allowed only when, of the 15 units most recently added to the
  place (by the commit that first added their file) that the map can tell, at
  least 80% follow it as they stand. It needs git history. A Python place
  advises only.
- `drift review` offers the practices that qualify after the proposals (`y`,
  `b`, `n` remembered, `s`, `q`), and the Studio has the same step.

### Behaviour changes: what `none`, `internal`, `identified` and setup say

- **`none` and `internal` are worded as what Drift found in what it read.**
  `drift practices` says "no guard found in what Drift read" (authentication) and
  "no role check, tenant scope or owner scope found in what Drift read"
  (authorization); `drift security` says "internal in what Drift read" and lists
  "Entry points where Drift found no guard", each row with `N not read`. The words
  come from one place and are the same in the CLI, the hooks, the MCP tools, the
  cards and the Studio. JSON keeps the value `none` and adds `basis` (`bodies`,
  `followed`, `not_read[{kind, what, why}]`, kinds `package_function`,
  `depth_limit`, `not_modelled`, `description`, `file`) on `none` units and
  inventory rows, and `exposure_basis` on `internal` rows. Keys and `P-` ids of
  `none` variants are unchanged.
- **`identified`.** Authentication that identifies the caller and turns no one
  away is its own state (it was `known` with an `identifies:` key): counted apart
  from `known`, never a recipe to copy. Its key keeps `identifies:<instrument>`.
- **`drift setup`.** An agent's answer that only makes Drift more cautious counts
  only while it keeps Drift as cautious, and is judged again whenever the config
  is read: if the repository changes so that it would make routes reachable only
  from inside, those routes read unknown and the question is asked again. An
  agent never removes, replaces or rejects a person's answer (it proposes). Drift
  removes only the exact lines it wrote, and otherwise refuses and names the
  line. `--by person` needs a terminal, or `DRIFT_SETUP_PERSON=1` for that run,
  for anything that writes. Edits made during an interactive run, CRLF line
  endings and a missing final newline are kept. A declared check settles no route
  where its refusal can be swallowed, skipped (`assert`, `Promise.allSettled`, a
  callback of an element method such as `forEach`) or aimed at another record.
  Interactive `drift setup` asks questions in an order that can change as you
  answer; the ids `--list` prints are what `--answer` takes.
- **Reading changes.** Python class-based views are read in C3 order with what
  the framework runs for every request. A tenant filter's answer does not depend
  on the column's name: an unlisted key reads unknown, never `none`. TypeScript:
  a response built as a value refuses only where it is returned; Nest providers,
  ORM configuration and Next.js configuration Drift cannot follow make the routes
  they may reach unknown. Lowering versions: Python 65, TypeScript 71 (a cache
  from before rebuilds).

### Already in this line, unchanged by round 11

- **Suggestions stay advice.** They are not shown to agents unless their rule
  family meets the agent admission bar (85% accepted of at least 10 labelled
  cards; no family meets it today) or a person runs `drift review
  --show-to-agents <id>`. Blocking one needs `drift review --block <id>
  --force`.
- **Review surface.** `drift review` shows each card's outliers;
  `--exempt <id> --member <path#symbol> --reason "..."` marks one as a
  legitimate exception, and `--list` / `--show` print cards without changing
  anything.
- **Review log** (opt-in, local only): `drift review --set-log on`.
- **Agent verifier** (experimental, unvalidated, off by default):
  `agents.verify: on`.
- **Wiring rules** (experimental, advice only): `experimental: [wiring]`.
- **Claude Code plugin**, **`drift mcp`** (eight read-only tools), **pull
  request mode** (`drift check --diff-base <ref>`), **SARIF**, a **GitHub
  Action**, **pre-commit hooks** and **`drift security`**.

## Upgrading from an earlier build

- Re-run `drift init`: it keeps every decision and id and adds new proposals.
- **Upgrade every machine and CI before promoting a practice.** A Drift from
  before promotion cannot read a `.drift/conventions.yaml` that holds a
  `practice` rule: it stops with a parse error naming the rule type. The file's
  `version` does not change.
- **Agents stop seeing default-tier proposals you have not accepted.** Accept
  the ones you want agents told about (`drift review`). Accepted conventions
  are unaffected.
- **Python proposals are dropped** when `.drift/conventions.yaml` is read with
  Python proposals turned off (`proposals: {python: off}`). Python conventions a
  person accepted, rejected or chose to show to agents are kept and checked.
- **Suggestions the show policy hides are dropped** the same way, unless a
  person accepted, rejected or showed them to agents.
- A suggestion already set to block (with `--force`, or before tiers existed)
  keeps blocking until a person changes it. Re-check such conventions with
  `drift review`.
- Formats: facts `schema_version` 11, `selector_version` 3, TypeScript lowering
  70, Python lowering 63. The Studio reads facts schemas 4 to 11.

## Known limits

- **The default tier has not passed the release gate.** It may block without a
  person's choice only after it measures ≥ 95% accepted on a held-out set
  (decision D1). Out of sample it measured 46.7% (7/15), Wilson 24.8–69.9%.
  Review each block candidate; do not accept them in bulk.
- **Small samples.** The out-of-sample suggestion figure is 6 of 7 cards from 4
  repositories; the Python figures are 1 of 2 (round 10) and 10 of 11 (the
  dev5-py-check, a blind dev pool, not a held-out set). See
  [ACCURACY.md](ACCURACY.md).
- **Low yield on new repositories.** Expect about 1 card shown and about 0.6
  accepted per TypeScript/JavaScript repository, and about 0.4 shown and 0.3
  accepted per Python repository. Most
  repositories get none: a convention needs a role of roughly 20 or more similar
  symbols where one pattern dominates.
- **No real-maintainer accept rate yet.** Every precision figure comes from blind
  labelling agents under rubric v3.
- **The wrong default-tier cards are mostly scope errors:** the role holds a
  recurring, different kind of member (a config file, a script, a plain helper)
  that the rule should not cover. They show up in the card's outliers.
- **Conventions only.** Drift is not a linter, a type checker or a security
  scanner; `drift security` is an inventory for a person to review, and it never
  fails a check.
- **The shell-command guard is best effort.** The hook that stops agents writing
  to `.drift/` or `drift.lock` does not see paths built by expansion or commands
  inside `sh -c '...'`.
- **The GitHub Action builds Drift from source** with `cargo`: the first run
  takes several minutes.
- **Release binaries are not code-signed or notarised.** They come with
  `SHA256SUMS` and SLSA build provenance.
- **The Studio is not packaged.** It runs from a checkout (`npm run start -w
  drift-studio`); packaging, signing, notarisation and auto-update are not done.
- **Recall is not measured** for this product.

## Decisions behind this release

| Decision | What | Record |
| --- | --- | --- |
| D7 | The default tier is TypeScript/JavaScript call wrappers and layering; Python has no default tier | [eval/study/README.md](../eval/study/README.md) |
| D1 / release gate | The default tier may block by default only after ≥ 95% accepted on a held-out set | [eval/study/README.md](../eval/study/README.md) |
| D10.1 | Agents see the default tier and only admitted suggestions | [eval/study/PLAN-PAR.md](../eval/study/PLAN-PAR.md) |
| Round-10 show policy | Suggestions with ≤ 1 outlier in leave-one-repo-out admitted families; some families hidden | [eval/study/PLAN-R10.md](../eval/study/PLAN-R10.md) §4 |
| D13-default | Block candidates reach agents only once a person accepts them | [eval/study/PLAN-R11.md](../eval/study/PLAN-R11.md) §2, §6 |
| D13-py | Python mined proposals: off by default in round 11, on by default since the dev5-py-check passed (closed) | [eval/study/PLAN-R11.md](../eval/study/PLAN-R11.md) §3, §6; [PREREG-F12-dev5-py-check.md](../eval/study/PREREG-F12-dev5-py-check.md); [dev5-check.md](../eval/study/runs/dev5-py/dev5-check.md) |
