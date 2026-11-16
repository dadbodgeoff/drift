# Conventions and Review

This page explains how Drift mines conventions from your code, how a person promotes a practice from the practice map to a convention, what tiers and suggestions are, how you review and decide, what `drift.lock` is, and how outliers and set-apart files work. It is for the people who run `drift init` and `drift review`, and for leads who need to know what a proposal's numbers mean before they let one reach agents or CI.

## What a convention is

A convention is a pattern that most members of a role follow, with the members that do not follow it listed as *outliers*. "HTTP handlers in `app/**` are wrapped in `withAuth()` (38 of 42)" is a convention. Drift ships none. Every convention says what your repository's code already does, and none is checked, shown to an agent or able to block until a person accepts it.

A convention comes from one of two places:

| Origin | How it starts | What decides "follows" |
| --- | --- | --- |
| **Mined** | Drift finds it (`drift init`) and proposes it; a person accepts or rejects it in `drift review` | the rule matched against each member of the role (a wrapper, a decorator, a name, an import, ...) |
| **Promoted from the practice map** | a person reads a practice in `drift practices` and promotes it (`drift practices promote`, the practices step of `drift review`, or the Studio); it is written as accepted at once | the practice map's classifier: the unit does the concern one of the accepted ways. A unit the map cannot tell is never reported |

Both live in one file and have one lifecycle: accepted or rejected, advise or block, `drift review --advise` and `--reject`, `// drift-ignore <id>: <reason>`, and `drift.lock` for the code that was there before. One step differs: a promoted practice is set to block by promoting it again with `--block`, which Drift allows only when a replay of recent work supports it ([Block mode and the replay](Practices-Map#block-mode-and-the-replay)). A promoted practice is marked with `promoted_from_practice: P-…` (the variant it came from) and its rule type is `practice`. How a practice qualifies and what promoting it writes are on [Practices Map](Practices-Map#promoting-a-practice-to-a-convention).

A convention has an id (`D-37416b`), a status (`proposed`, `accepted`, `rejected`), a mode (`advise` or `block`), a role, a rule, its evidence, an example to copy, and any exceptions. They live in `.drift/conventions.yaml`, which you commit.

## How conventions are mined

Mining looks inside each role (a group of similar things that live together: see [How Drift Works](How-Drift-Works)). A fact becomes a candidate when:

- the role has at least 8 members and at least one outlier;
- the 95% Wilson lower bound of the share that follow it is at least 0.75 (0.9 for layering rules);
- it is at least 1.5 times more common in the role than in the rest of the repository (3 times for calls of a package or built-in and for directives).

Call order, preferred libraries, dependency versions and import sources are counted over the members they concern, and models and packages over the whole population, with no lift test. Alternatives count together: `withWorkspace` or `withSession` in the same slot form one convention, and the split is reported.

What rules cover: wrappers, decorators, base classes, argument keys, calls, rendered components, directives, input validation, return types, thrown error classes, naming (`use*`, `*Service`), call order ("`auth()` before `db.query()`"), avoidance (risky operations, `process.env`, `console.*`, `any`, imports that break layering), test files, one library per slot, model fields, package scripts and tsconfig flags, and the dependency versions a workspace agrees on.

### Roles

- **Roles come from structure only:** package, directory prefix, kind of file, entry-point kind and symbol kind. A role is frozen as a selector once approved, so `check` never re-clusters, and a convention records how its selector is read (`selector_version` in `conventions.yaml`).
- In a Next.js route file, each reserved export name (`generateMetadata`, `generateStaticParams`, ...) forms a role of its own; a convention accepted before that (no `selector_version`) keeps checking the members it held, exemptions included.
- A `const` that only names an in-repo function, or, in TypeScript, holds the result of a factory proven to return a function, is a function member of its role.
- A file name is a kind of file when it recurs across more folders than the files that usually sit beside it (`page`, `route`, `columns` in one folder per feature). A name used once per layer folder (`routers/invoice.ts`, `schemas/invoice.ts`) is a domain, and the file stays in its folder's role. Dynamic route files (`[id].tsx`, `[...slug].ts`) are one kind.

### Members a rule is not about

Some members are listed apart (`exempt` in `census --json`, never reported by `check` or the hooks), and each member's reason is in `exempt[].code`:

- a rule's own target (`BaseService` under "extend `BaseService`");
- a member that opts out of a team decorator with a decorator of the one package that decorator wraps, when no holder and at least two outliers carry it (`@ApiExcludeEndpoint()` next to an `@Endpoint()` built from `@nestjs/swagger`). An opt-out never counts from the framework of the entry points (`@nestjs/common`), from the primitive the wrapper wraps, or for a decorator that wraps several packages or looks like a guard or auth check; and, like every exemption, never for an entry point or under a guard rule;
- a factory of a call-wrapper rule's members (it returns a function wrapped in the rule's wrapper);
- for TypeScript and JavaScript naming rules, a companion of the followers in their file (a helper they use, an `UPPER_SNAKE` constant, another kind of class).

### Rule families, and what each needs

- **Avoidance needs contrast:** a role "avoids" something only when the rest of the same kind of code uses it at least 10% of the time and three times as often. Layering ("`packages/lib/**` does not import from `packages/features/**`") is proposed only when the other area depends on this one, so the import would close a cycle; importing a package the importer declares in `package.json` is intended and never counts. A re-export (`export { x } from`, `export * from`) is an import of its source; type-only imports and re-exports never count. Avoidance is capped at a quarter of a repository's conventions.
- **Absence of `console.*`, bare `Error` or `process.env` reads needs corroboration:** a lint rule at `warn`, or at least three members of the role using a team alternative (a logger, a non-built-in error class, an env/config module: a file named for env or config that itself reads `process.env`). Most code simply has no reason to log or throw.
- **Naming is a team choice across files:** a naming rule needs members from at least three files, never uses a CRUD verb (`get*`, `create*`, `list*`, ...), and ignores names a framework reserves. Prefixes and suffixes are computed for every name (`cityTimezonesSchema` has the suffix `Schema`).
- **Layering follows declared dependencies:** a package that declares another in `package.json` intends to import it, so only undeclared imports that would close a cycle break a layering rule ("do not import from `packages/platform/**` (declared dependencies excepted)"). A package may also load a peer or optional dependency (`peerDependencies`, `optionalDependencies`) lazily: inside a function, an `import()`, a `require()`, or a call of a repository helper whose body `require`s or `import()`s its parameter (`optionalRequire("@nestjs/websockets")`) is no violation for such a package. The same loads at module scope run with the module, and count. A static import of it still is a violation, and so is a lazy load of a package it does not declare.
- **Dependency versions follow the workspace:** "use the zod version most workspace packages use" is re-evaluated by `check` against a strict majority of the packages that depend on it, so when the workspace upgrades, the packages left behind are the violations, and halfway through (a tie) nothing is. The check message names the range (`zod@^4.1.0`); the ranges at mining time are evidence. Pins accepted earlier ("depend on zod@^3.25.0") keep their id and meaning.

What mining leaves out on purpose:

- **Code that is not production.** Tests, stories, fixtures and demonstration code are neither mined nor checked: a package inside an `example(s)`, `sample(s)`, `demo(s)` or `playground(s)` directory, or such a directory at the top of the repository or of a package (`examples/`, `packages/sdk/playground/`). A folder with one of those names deeper inside an app (`app/examples/page.tsx`) is production. A top-level `integration/` directory is test code when most of its tests are standalone (not unit tests next to a source file of the same stem). `drift check` skips these files too: accepted conventions do not apply to them. `drift security` leaves them out of the inventory and says how many it left out, and where.
- **What something else already decides.** A small table of framework requirements in `crates/drift-mine/src/frameworks.rs` (NestJS `@Injectable`/`@Module`/`@Controller`, TanStack `createFileRoute`, React's `use*` hook names, React Email's `<Html>`/`<Head>`/`<Body>`, decorator-metadata tsconfig flags, Next.js route-segment export names such as `generateMetadata` or `maxDuration`), and rules the repository's linter already enforces. ESLint (flat and legacy), oxlint and Biome configs are read, best-effort and without running them (only what a config file exports). If the config that covers a role enforces the equivalent rule (`error`: `no-explicit-any`, `no-console`, `no-process-env`, a `no-restricted-imports` entry naming the area) the rule is trivial and not proposed. A rule turned `off` or set to `warn` does not stop a proposal, and `warn` counts as the team's stated policy. A rule that restates a folder's name ("dialogs render `<Dialog>`", "`agent/**` builds a `ToolLoopAgent`") is not proposed either.
- **Noise.** Nested roles saying the same thing, near-duplicate rules, library primitives and tautologies such as "components return JSX".
- **Weak absences.** See above.

Mining's input is held at the entry points of the last measured build (the frozen build of the pre-registered Python check). The blind evaluation's verdict on mined proposals holds for a later build only while that build mines the same input. So the entry points Drift has learned to list since that build (Django patterns under `i18n_patterns`, from another module's list, or beside a `urlpatterns` that is not a list; the unread mount of a router handed on; message consumers found by library or acronym; route tables registered in a loop) are in `drift security` and the practice map, and are not yet read by `drift census`, `init` or `check`. They enter mining at the next measured round. `drift scan --json` shows both readings of a file they change (`listed`). TypeScript routers mounted more than once are not held this way, and their effect on mining is unmeasured.

Expect few proposals. A convention needs a role of roughly 20 or more similar symbols where one pattern clearly dominates. Small or uniform repositories often get none, and Drift then says so and names the largest role it saw. `drift init` proposes at most 15 conventions (`--max`).

## Tiers

Every proposal has a tier, computed from its language, rule kind, where its target is defined and the size of its role.

| Tier | Which conventions | What they can do |
| --- | --- | --- |
| **default** | TypeScript and JavaScript call wrappers and layering (import avoidance) whose every target is the repository's own code, in roles of 15 or more members | Listed first. Reach agents only after a person accepts them, then advise; block only when a person sets them to block |
| **suggestion** | everything else: every Python convention, decorators, base classes, JSX layout wrappers, generic calls, naming, absence, preferred libraries, call order, argument keys, rendered components, rules whose target is a package's or a built-in's, and any rule in a smaller role | Advise only. Shown to agents only when the rule family is admitted (none is today) or a person shows one with `drift review --show-to-agents` |

Default-tier proposals are *block candidates*. `drift census`, `drift init`, `drift review` and the Studio list them first, marked `agents: not shown to agents (block candidate: reaches agents once you accept it)`. No agent surface has one until a person accepts it. That is deliberate: out of sample, about half of the default tier was right (7 of 15 cards, see [Accuracy and Limits](Accuracy-and-Limits)), so your accept is the only check between a card and every agent session in the repository.

The tier is computed, never stored in `conventions.yaml`, so ids and policies do not change when the definition does. Its definition is the one pre-registered for the held-out precision study ([rule 5](https://github.com/dadbodgeoff/drift/blob/main/eval/study/README.md#held-out-rules), as amended by [decision D5](https://github.com/dadbodgeoff/drift/blob/main/eval/study/TIER-ADMISSION.md) and by [decision D7](https://github.com/dadbodgeoff/drift/blob/main/eval/study/README.md#decisions-before-any-held-out-census-2026-11-05), both approved before any held-out census; the table is `eval/study/tier-d7.json`). D5 moved argument keys, rendered components and rules whose target is a package's or a built-in's to the suggestion tier; D7 moved decorators, base classes and JSX layout wrappers, and every Python convention, there too. A target is "the repository's own code" when it is not a package's, a built-in's such as `Error`, or an unresolved symbol; a package object bound in the repository, such as `ma = Marshmallow()`, counts as the repository's.

`drift census --json` gives each proposal a `tier_reason`: `null` in the default tier, otherwise the first condition it fails, in this order:

| `tier_reason` | Meaning |
| --- | --- |
| `language_advise` | a Python convention (Python advises only) |
| `rule_kind_d7` | a decorator, base-class or JSX-wrapper rule, which was in the default tier until D7 |
| `rule_kind` | any other kind outside the default tier |
| `names_package` | a target from outside the repository |
| `small_role` | fewer than 15 members |

The text output says the same on each `tier:` line, for example `suggestion (Python conventions advise only; decision D7)`. `drift census --tier suggestion` (or `default`) lists one tier.

For the precision study only, `drift census --json --candidate d8` also gives each proposal the tier that decision D8's pre-registered candidate would give it (`candidate`: Python call wrappers whose every alternative is a guard, and layering, with in-repository targets, in roles of 50 or more; TypeScript and JavaScript as D7). D8 is not adopted: the option changes no tier, and Python still advises only ([decision D8](https://github.com/dadbodgeoff/drift/blob/main/eval/study/README.md#decisions-before-any-held-out-census-2026-11-05)).

### The release gate

A language's default tier ships as **advise** until it measures at least 95% default-tier accept under rubric v3 (judged as in decision D1: the point estimate per language, unlabelled counted as wrong) on a primary held-out run ([study protocol](https://github.com/dadbodgeoff/drift/blob/main/eval/study/README.md#targets-as-defined-in-the-plan-of-record)). No language has met it: out of sample, the TypeScript and JavaScript default tier measured 46.7% (7 of 15 cards, on blind and held-out pools; see [Accuracy and Limits](Accuracy-and-Limits)), and Python has no default tier at all. Until a language meets it, its default tier is advice: `drift init` proposes everything in advise mode, and nothing blocks unless a person sets it to block.

So in the beta, **only a default-tier convention that a person set to block can block** an agent's turn or fail `drift check`, unless the person explicitly forced a suggestion to block. A suggestion already set to block (with `--force`, before tiers existed, before D5 moved its kind or target to the suggestion tier, or before D7 moved decorators, base classes, JSX layout wrappers and every Python convention) keeps blocking until a person changes it. Re-check such conventions with `drift review`. `drift review --advise <ids>` moves accepted conventions back to advise without un-accepting them (a proposed or rejected one is accepted in advise mode); like `--block`, an unknown id is an error and nothing is written, and an id given to both `--advise` and `--block` or `--reject` is refused. It is a flag only: interactive review shows proposals, not accepted conventions.

Roles of fewer than 15 members never block, even with `--force`, and `drift check` treats `mode: block` in such a role as advise even in a hand-edited policy. The marker `[advise only: small role]` shows it.

### Suggestions are filtered, and capped in the listing

Drift proposes a suggestion at all only when it has at most one outlier and its rule family is admitted for its language (the round-10 "show policy"): with any one development repository left out, the family's suggestion-tier accept on the other development repositories is at least 60% of at least 5 labelled cards. Call order is never proposed, in either language, and neither are TypeScript rendered-component and call rules or Python package and repository facts. The table is committed data, `crates/drift-mine/data/show-policy.json` ([PLAN-R10 §4](https://github.com/dadbodgeoff/drift/blob/main/eval/study/PLAN-R10.md)), frozen in the binary. A withheld card is not proposed: `census` (`--all` included), `init`, `review`, `check`, the hooks and the Studio never list it, and a proposal of it that an older Drift wrote to `.drift/conventions.yaml` is dropped when the file is read. A convention a person accepted, rejected or chose to show to agents is kept and checked whatever its family. The default tier is not affected. This is separate from what agents are shown, which has its own, higher bar (see [Using Drift with Agents](Using-Drift-with-Agents)). `drift review --hidden` lists the cards mining found and withheld, with the reason, and lets a person promote one with `--answer ID=same|different|not-a-convention` (written as accepted by them, with `promoted_from_hidden: true`).

The listing shows every default-tier proposal and the 5 best suggestions. (Mining's own caps come earlier: at most 5 rules per role, a quarter of `--max` layering rules, and `--max` in all. When they cut a default-tier rule, `drift census` says so, and `drift census --why` lists it.) Suggestions are ranked by the higher lower bound, then fewer outliers, then the higher lift, then id. The rest wait behind a "Showing 5 of N suggestions; M more" line: `--all` lists every suggestion, `--suggestions N` the best N, and `suggestion_cap: <N|all>` at the top of `.drift/conventions.yaml` changes the default. This is presentation only: nothing is deleted, no id or tier changes, and the cap changes nothing for `drift check`, hooks, MCP or exports (what agents are shown is the family admission's). `census --json` keeps every proposal, in this order (`rank`), with `shown_by_default` and the cap in effect (`suggestion_cap`).

### Python

Mined Python proposals are on by default, every one a suggestion. Turn them off with:

```yaml
# .drift/config.yaml
proposals:
  python: off
```

Only `off` (or `false`) turns them off, and `on` (or `true`) says the default. Any other value is ignored with a warning and leaves them on; so does a config Drift cannot read (`drift census` and `drift init` stop on one). Off, `drift census` and `drift init` say how many they did not make (`census --json`: `python_proposals.withheld`; the object is absent when they are on), and a Python proposal an earlier run wrote is dropped when `.drift/conventions.yaml` is read. Python conventions a person accepted, rejected or chose to show to agents are kept and checked either way, and Python facts, `drift check` and `drift security` are unaffected. `drift census --python-proposals` makes them for one census whatever the config says, writing nothing: it is the study's view.

**The decision (D13-py, closed 2026-11-11).** Round 11 turned mined Python proposals off, because their only blind estimate was two cards, and fixed what would turn them back on: a blind pool, measured at a frozen product, with at least 10 shown Python cards, at least 70% of them not wrong, and a per-card accept within 10 points of the in-sample figure ([PLAN-R11 §3](https://github.com/dadbodgeoff/drift/blob/main/eval/study/PLAN-R11.md)). That check was pre-registered ([PREREG-F12](https://github.com/dadbodgeoff/drift/blob/main/eval/study/PREREG-F12-dev5-py-check.md)) and passed ([dev5-check](https://github.com/dadbodgeoff/drift/blob/main/eval/study/runs/dev5-py/dev5-check.md)): 11 Python cards shown on 30 blind repositories, 10 accepted, 1 trivial, none wrong; not wrong 100.0%, per-card accept 90.9% against 83.3% in sample. The decision is closed with the default on. What the run does not show: it is eleven cards, one above the minimum, the wrapper family had no out-of-sample card, and a held-out pass is still needed before any Python accuracy claim. Every Python convention is a suggestion (`tier_reason: language_advise`), so none blocks unless a person forces it (`drift review --block <id> --force`). Some Python proposals flag code that has to be that way (a layering rule whose only outlier is the app's entry module, which must import its routers). The evidence for the default is small; see [Accuracy and Limits](Accuracy-and-Limits).

## Reviewing and deciding

```bash
drift review
```

Interactive review shows the mined proposals, the default tier first, then the 5 best suggestions (`drift review --all` for every one), and after them the practices that may be promoted ([below](#practices-that-may-be-promoted)).

| Key | Meaning |
| --- | --- |
| `y` | accept it, in advise mode |
| `b` | accept it and set it to block (on a suggestion you must type `block` to confirm) |
| `a` | accept it and show it to agents (for a suggestion whose family is below the admission bar) |
| `n` | reject it |
| `s` | skip it |
| `q` | quit |

Without a terminal, use flags. Ids are comma-separated; an id not in the policy is an error (exit 2) and nothing is written.

```bash
drift review --accept D-37416b
```

```bash
drift review --block D-37416b
```

```bash
drift review --advise D-37416b
```

```bash
drift review --reject D-04385a
```

```bash
drift review --show-to-agents D-04385a
```

Each card's `agents:` line says whether agents are shown it. Each run ends with the counts, for example `4 accepted (2 block), 10 proposed, 1 rejected`, and how many accepted conventions agents are not shown, when there are any; interactive review ends by saying how many accepted conventions block. `--advise` is the way back from block mode and keeps the convention accepted. `--block` on a suggestion is refused unless you add `--force`. `drift review --list` prints the cards interactive review would ask about, and `drift review --show D-37416b` prints one card of any status, with its outliers (the first 5; `--all-outliers` for all). To change your mind later, use the flags above or edit `status` and `mode` in `.drift/conventions.yaml`. Re-running `drift init` keeps every decision and id and adds new proposals.

### Practices that may be promoted

After the proposals, interactive `drift review` offers the practices from the practice map that may be promoted now (the same list as `drift practices promote --list`), one at a time. Each shows the preview `drift practices promote --dry-run` prints: how many units of the place follow, the ones that differ and would be recorded in `drift.lock`, what could not be read, and the command.

| Key | Meaning |
| --- | --- |
| `y` | promote it, in advise mode |
| `b` | promote it in block mode, which needs the replay to allow it ([Block mode and the replay](Practices-Map#block-mode-and-the-replay)) |
| `n` | no: this is not our rule. Remembered, so review does not offer it again |
| `s` | skip it for now; it is offered again next time |
| `q` | quit |

A practice promoted here is the same as one promoted with `drift practices promote`: an accepted convention, shown to agents, with today's exceptions in `drift.lock`.

A unit follows a promoted practice when the practice map reads it doing one of the accepted ways. For sign-in, permissions, validation and responses, doing more than the accepted way still follows it (a route signed in with the accepted guard that also checks something else); for the other concerns, the whole of what the unit does must be an accepted way. For sign-in and permissions, background jobs are not counted: they take no request. See [How the rule is checked](Practices-Map#how-the-rule-is-checked).

### What to look at on a card

Read the outliers first. If they are mistakes, accept the card. If every outlier is a legitimate, different kind of member (a test helper, a config file, a script), the rule is not about them: reject the card, mark those members fine, or set them apart.

### Marking an outlier fine

When the rule is right but one outlier is a legitimate exception, give it a reason (one line, at most 120 characters; agents see it):

```bash
drift review --exempt D-37416b --member app/api/health/route.ts#GET --reason "health check, public by design"
```

```bash
drift review --unexempt D-37416b --member app/api/health/route.ts#GET
```

It is stored in `.drift/conventions.yaml` under the convention's `exceptions`, by `path#symbol`, so it survives the member moving within its file. `drift check`, the hooks and CI then list it as exempt (`marked fine by a reviewer: ...`) instead of as a violation. Only a current outlier can be marked.

Where a reviewer's exception was recorded for a member that is in `drift.lock` with a fingerprint (below), the exception follows that member when it moves to another file or is renamed, as if the reviewer had named its new place. `.drift/conventions.yaml` keeps the member the reviewer named. An exception for a member the lock has no fingerprint for (one marked fine after it was baselined, or a lock written before fingerprints) does not follow it.

### `drift-ignore` comments

For a single declaration, put `// drift-ignore D-37416b: <reason>` (`#` in Python) directly above it. The id is `D-` and six hex digits, and a reason is required: a comment without one suppresses nothing. Suppressions are counted in the output so reviewers see them.

Some violations are about a whole file, not a declaration: a file's exports or directives, a layering import, a model. These take the comment in the file's header, among the comments before its first line of code (blank lines, a `#!` line, directives such as `"use client";` and a one-line docstring may come before it). The comment may be written with `//`, `#`, `--` or `/* */`.

| The violation is about | Where the comment goes |
| --- | --- |
| a declaration | above the declaration |
| a model | directly above the model, or at the top of its file |
| a layering import | at the end of the import's line, in the comment lines directly above it, or at the top of the file |
| anything else about a file | at the top of the file |

A file that holds no comments (`package.json`) cannot carry one. The agent is then told: `if intentional: no drift-ignore comment can go in this file; say so to a person, who can mark it fine (`drift review`)`. Wiring advice and promoted practices take the comment on the declaration only.

### "Are these the same kind of thing?"

Each block candidate carries one question, shown in interactive review, in `drift review --json` and in the Studio: it shows two or three members that follow the rule and every member it would flag, by file.

```bash
drift review --json
```

```bash
drift review --answer D-37416b=same
```

```bash
drift review --answer D-37416b=not-a-convention
```

```bash
drift review --answer D-37416b=different --set-apart lib/seed.ts,test/fixtures/a.ts
```

`same` accepts the card, `not-a-convention` rejects it, and `different` accepts it with the files you list *set apart*: stored as a path list under `different_kind` in `.drift/conventions.yaml`, and applied by `drift check` by path (the member is exempt, with code `different_kind`). An entry point under an authentication or validation rule is never set apart this way unless you also confirm it by name with `--confirm-entry app/api/health/route.ts#GET` (a separate tick in the Studio); without that it stays flagged. A question nobody answers changes nothing: the card stays a candidate and reaches no agent.

## What blocks and what advises

| | Proposed | Accepted (advise) | Accepted (block) |
| --- | --- | --- | --- |
| `drift check` | not checked | listed, exit 0 | listed, **exit 1** |
| `drift check --strict` | not checked | **exit 1** | **exit 1** |
| Claude Code, before writing and after an edit | nothing | advice | advice, marked `(blocks)` |
| Claude Code, end of turn | nothing | nothing | **blocks** (steps aside after 3 blocks or no progress) |
| GitHub Action | nothing | code scanning warning | code scanning error, **job fails** |
| pre-commit `drift-check` | nothing | nothing | **commit fails** |

Only a person puts a convention in block mode. In the beta only a default-tier convention that a person set to block can block, unless a person forced a suggestion with `--force`. Wiring rules (experimental) never block.

A convention set to block still advises when one of these holds, and `drift check` says why on a line of its own (`drift: [<id>] was block, now advise because ...`):

- `its role had N members when it was mined, under the 15 needed to block`;
- `it was promoted below the share of its place a practice needs to block`;
- `experimental wiring rules only advise`;
- `it is stale: ...` (below).

Where an agent is shown a list of violations, it is capped at 5 and the ones that block come first, so a capped list never hides one that blocks behind advice. The rest are counted, by mode: `+N more (B that block, A advice): run `drift check` to see all`. The GitHub job summary lists at most 10, those that block first.

## What `drift check` could not tell

A mined rule is checked by reading each member. For some rules, what decides the rule may be in code Drift did not read. Then the member is **not checked**: Drift does not report it, and does not call it fixed. This applies to accepted conventions only; `drift init`'s baseline and the review cards read members as mining does.

| Rule | A member is not checked when |
| --- | --- |
| wrapped by | `it is wrapped in <w>, which does not resolve to code Drift read`; `it is wrapped in <w>, which is built in a file Drift did not read`; `it is wrapped in <w>, which <f>() builds: what it does is in that factory, which Drift does not follow for this rule` |
| passes a key | `its call of <c>() unpacks a value into its arguments, so it may pass any key` |
| calls, calls before | `it hands a value to a call Drift did not record (a method of a local or of an untyped parameter), which may be the call the rule asks for` |
| renders | `it renders <r>, which does not resolve to code Drift read` |

For a wrapped-by, calls or calls-before rule whose target signs the caller in or checks permissions, an entry point the practice map marks `unknown` for that concern is not checked either: `the practice map cannot tell how it handles sign-in` (or `permissions`). The other rule kinds read every member.

`drift check` prints one line per rule with members not checked, with at most three reasons:

```text
drift: [<id>] <n> of <members> member(s) not checked: Drift could not read what decides the rule for them, and never reports what it cannot read (<holders> follow it)
  why  <reason> (<n>)
```

The `drift.lock` line of a member not checked stays. With `--format json`, `standing` lists every accepted mined rule with its counts and all the reasons ([Output and JSON Reference](Output-and-JSON-Reference#drift-check---format-json)). None of this changes the exit code.

**Stale mined rules.** On a check of the whole repository, an accepted mined rule is stale when its evidence no longer holds:

- `its role has N member(s) now, under the 8 a mined rule needs`;
- `H of the T members Drift can tell follow it now, under the 75% a mined rule needs`.

A stale rule advises until a person looks: `drift: [<id>] mined rule is stale: <why>, so it advises until a person looks: `drift review --advise <id>` keeps it as advice, `drift review --reject <id>` drops it`. A check of named files does not decide staleness. A promoted practice has its own staleness ([Stale: the way is gone](Practices-Map#stale-the-way-is-gone)).

## `drift.lock`

`drift.lock` lists the legacy violations Drift found when you ran `init`, or when a person promoted a practice: the outliers that already existed, one `<convention id> <path#symbol>` per line, sorted. Below each, a comment line `#~ <convention id> <fingerprint> <path#symbol>` records a fingerprint of the member's code ([Files Drift Writes](Files-Drift-Writes#driftlock)). Legacy code never fails a check; only new violations do. To shrink the lock, fix the code. Drift only ever removes lines; people add them, which is what makes `drift.lock merge=union` in `.gitattributes` safe for parallel branches. The lock covers every proposal, while `drift check` counts the legacy violations of accepted conventions only, so its legacy count is smaller until you accept them all.

**Moved code.** When a legacy member moves to another file with its name and code unchanged, its fingerprint still matches. On a check of the whole repository, a violation whose own `path#symbol` is not in the lock is baselined when its fingerprint and name match a fingerprint line of the same convention whose member is gone from the code, and only when that is one gone member for one new violation: a copy of baselined code next to the original is new, and so is a new violation beside a deleted one that reads the same. A check of one file never concludes a move. A lock written before fingerprints works as before: a moved member no longer matches its key, so a plain `drift check` reports it, while pull-request mode keeps it quiet. See [Drift in CI](Drift-in-CI).

**Re-running `drift init`.** Only a convention new to the policy has its violations baselined. An existing one is never baselined again, even once all its old violations are fixed: a violation added since is reported, not recorded. Existing lock lines gain their fingerprint line.

**What a person accepted.** The first time `drift init` meets a convention accepted, it keeps the evidence as it stood beside the convention, under `accepted_evidence` (`role_size`, `holders`, `total`, `lower_bound`). `drift init` rewrites `evidence` on every run, so this is how a reader tells that the role a block was accepted on has since shrunk. In `.drift/conventions.yaml` accepted conventions come first, then proposed, then rejected; decided conventions are ordered by id, so a run that only refreshes evidence moves no line of what people decided, and proposals stay strongest first.

## Outliers and set-apart files, in short

| Term | What it is | Where it lives | Effect |
| --- | --- | --- | --- |
| Outlier | a member of the role that does not follow the rule | computed each run | reported by `drift check` as a violation (new) or legacy (in `drift.lock`) |
| Legacy outlier | an outlier already present at `init`, or when a practice was promoted | `drift.lock` | never fails |
| Not checked (promoted practice) | a unit of a promoted practice's place the practice map cannot tell | computed each run | counted by `drift check`, never reported, never fails |
| Marked fine (`exceptions`) | an outlier a reviewer approved with a reason | `.drift/conventions.yaml` | listed as exempt, with the reason |
| Set apart (`different_kind`) | files whose members are a different kind of thing | `.drift/conventions.yaml` | exempt by path, code `different_kind` |
| Exempt by mining (`exempt` in `census --json`) | members a rule is not about: the rule's own target, an opt-out through a decorator of the wrapped package, and similar | computed | never reported by `check` or the hooks |
| Not checked (mined rule) | a member of an accepted mined rule whose rule Drift could not read for it | computed each run | counted by `drift check` (`standing`), never reported, never fails; its lock line stays |
| `drift-ignore` | a comment above a declaration, or at the top of a file | source | suppresses one violation, with a reason |

## Monorepos

Run `drift init` once, at the repository root. Drift finds the packages and mines each in its own scope, and writes one `.drift/` at the root. `drift check`, the hooks and MCP find the package of a touched file from any directory. To override what counts as a package:

```yaml
# .drift/config.yaml
packages:
  roots: [frontend, backend/services/*]
  exclude: [backend/services/legacy]
```

`check`, `review`, `example` and `export` run without `--root` from a directory with no `.drift/conventions.yaml` use the nearest policy above it. `drift census` lists each package with its cards, or why it is silent.

**Opting in: layering inside one package (experimental).** By default, an import between two folders of the same package is not a layering signal. To mine and check layer rules inside each package of a workspace (`apps/web: files in modules/** do not import from lib/jobs/**`), turn it on:

```yaml
# .drift/config.yaml
experimental: [intra_package_layering]
```

`DRIFT_EXPERIMENTAL=intra_package_layering` does the same for one run. It is off by default because, on the public build set, 1 of its 8 new cards was labelled ACCEPT ([monorepo11](https://github.com/dadbodgeoff/drift/blob/main/eval/study/research/2026-11-09/monorepo11.md)). The cards it adds are proposals like any other, and nothing is checked until a person accepts them.

## Experimental: wiring rules

With `experimental: [wiring]` in `.drift/config.yaml` (or `DRIFT_EXPERIMENTAL=wiring`), Drift also learns where new code must be registered: a `@Module` providers list, a barrel, `urlpatterns`, `INSTALLED_APPS`, a router table. It also learns, from git history, which files always gain the same environment keys (the one case where Drift reads history: the newest commits of `HEAD`, bounded in time and size and never fetched; a shallow or partial clone gives no history rules and says why). These rules are suggestions that only advise: `drift check` (also with `--strict`) and the hooks never fail or block on them. The fix names the list, its line and a registered sibling:

```
  fix  add RefundsService to Module() providers in src/app.module.ts:10 (like BillingService, line 12)
```

See [WIRING-2026-11-06](https://github.com/dadbodgeoff/drift/blob/main/docs/v2/WIRING-2026-11-06.md).

## An example on a real repository

On dub, a Next.js monorepo of 3,921 files and one of the development repositories, an earlier build of `drift census` proposed conventions such as:

```
 1. [D-d24d21] apps/web: HTTP handlers in app/api/** (route files) are wrapped in withSession() or withWorkspace()
    evidence: 138/169 (lower bound 0.75, lift 6.5)
    tier:     default
 3. [D-83351e] apps/web: HTTP handlers in app/(ee)/api/partner-profile/** (route files) are wrapped in withPartnerProfile()
    evidence: 53/54 (lower bound 0.90, lift 36.6)
    tier:     default
 6. [D-e25af3] packages/email: components in src/** render <Footer>
    evidence: 101/106 (lower bound 0.89, lift 16.5)
    tier:     suggestion (rule kind renders)
```

If an agent then adds an unguarded route, `drift check` reports the rule, its evidence and the file to copy, and fails once a person has set the rule to block:

```
[D-83351e] apps/web: HTTP handlers in app/(ee)/api/partner-profile/** (route files) are wrapped in withPartnerProfile() (53/54)
  at   apps/web/app/(ee)/api/partner-profile/new-thing/route.ts:3 GET
  like apps/web/app/(ee)/api/partner-profile/invites/route.ts#DELETE
  mode block
```

These cards were recorded at an earlier build and not re-run for this wiki; the numbers on your repository will differ.

## Optional review log

`drift review --set-log on` (or `review_log: on` in `.drift/conventions.yaml`) records each decision and each card shown in `.drift/review-log/`, local only. The directory holds a `.gitignore` of `*`, so it is never committed, and nothing is sent anywhere. It exists to collect real-maintainer accept rates for Drift's evaluation (decision D10.3 in [PLAN-PAR](https://github.com/dadbodgeoff/drift/blob/main/eval/study/PLAN-PAR.md)). It is off by default. `--log` records one run without the setting. It records each decision (accept, reject, block, forced block and whether the Studio offered it as the record-backed or the neutral Block, advise, show to agents, skip, an exception marked fine or removed, with its reason) and each card shown (with its rank, tier, family, admission decision and verifier status), with the card's evidence and Drift's version; for the one-question flow, how many flags you saw and which you set apart (`question`, `set_apart_members`). Off, no file is written and no output changes. It is never written through a symbolic link, appends take a lock (the command line and the Studio may write at once), and it rotates at 4 MB into one older file. `drift review --export-log FILE` writes a study file for `eval/study/maintainer-log.mjs`, which reports flag precision as maintainers judge it; convention ids, members and examples are hashed (blake3 keyed with a random salt kept in `.drift/review-log/salt`, one per repository) and reasons are replaced by their length, unless you pass `--include-paths`.

See also: [Getting Started](Getting-Started), [Practices Map](Practices-Map#promoting-a-practice-to-a-convention), [Using Drift with Agents](Using-Drift-with-Agents), [Drift in CI](Drift-in-CI), [Team Rollout](Team-Rollout), [Accuracy and Limits](Accuracy-and-Limits), [Configuration Reference](Configuration-Reference).
