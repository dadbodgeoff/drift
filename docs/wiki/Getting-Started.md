# Getting Started

This page takes you from nothing to a first run of Drift on one repository: installing it, learning conventions, deciding on them, checking new code, and knowing what was written to disk and what to commit. It is for an engineer trying Drift for the first time. Budget about ten minutes on a small repository.

Everything below runs locally. Drift reads your working tree and writes under `.drift/` and to `drift.lock`. Nothing is sent anywhere, nothing reaches an agent until a person accepts it (a suggestion also needs a second step, in section 5), and nothing blocks until you say so.

## 1. Install

Drift is a single binary, `drift`. Nothing is published yet: there is no npm package and no release archive. Until the first release, use one of the two paths below. Both end at `drift --version`.

**A binary a teammate gave you.** It must be built for your operating system and CPU. Put it in a directory on your `PATH` and make it executable:

```bash
mkdir -p ~/.local/bin
```

```bash
cp ./drift ~/.local/bin/drift && chmod +x ~/.local/bin/drift
```

```bash
drift --version
```

If `drift` is not found, add `~/.local/bin` to your `PATH`. Install it as `drift` on your `PATH`, not only in one directory: the Claude Code hooks and the pre-commit hooks run `drift` from your `PATH`.

**Build from source.** You need a checkout of the repository and Rust 1.97. The repository pins it in `rust-toolchain.toml`, and `rustup` fetches it the first time you run cargo inside the checkout:

```bash
cargo install --locked --path crates/drift-cli
```

A release build takes several minutes. It installs the `drift` binary into `~/.cargo/bin`, which `rustup` puts on your `PATH`. Then check it:

```bash
drift --version
```

**After the first release.** The release channels will be an npm package (`@dadbodgeoff/drift`; a beta under npm's `next` dist-tag, so `@dadbodgeoff/drift@next`) and prebuilt archives on the repository's GitHub Releases, with checksums and build provenance. Neither exists today: `npm install -g @dadbodgeoff/drift` returns 404. When they do, the archive steps are in [RELEASING.md](https://github.com/dadbodgeoff/drift/blob/main/RELEASING.md).

## 2. Preview what Drift would propose

Run these from the repository root (or pass `--root <dir>` to every command). `drift census` changes nothing:

```bash
drift census
```

**On a large repository, expect to wait.** Each command that reads the whole repository (`census`, `init`, `check`, `security`, `practices`, `setup`, `investigate`) reads it again and prints nothing until it has finished; the cache saves parsing, not the rest of the reading. Measured on one monorepo of 5,858 files, with a warm cache unless noted:

| Command | Time |
| --- | --- |
| `drift census` (cold cache) | 20.6 s |
| `drift init` | 24.7 s |
| `drift review --list` or `--hidden` | about 12 s |
| `drift check` | 8.7 s |
| `drift security` | 6.1 s |
| `drift practices` | 15.6 s |
| `drift setup --list` | 28.2 s |
| `drift card <file>` | 7 to 11 s |

Interactive `drift setup` (and `drift setup --review`) reads the repository first and only then asks: on that monorepo the first question came after about 24 to 35 s. It has not hung; wait for the first question. If you type answers ahead, they go to whichever question is on screen when they arrive. Commands that only write a decision (`drift review --show-to-agents`, `drift findings`, `drift export`) return at once. These are one machine's figures, not a promise. See [Troubleshooting](Troubleshooting#commands-take-tens-of-seconds-on-a-large-repository).

## 3. Learn: `drift init`

```bash
drift init
```

This writes the proposals to `.drift/conventions.yaml` and baselines today's violations in `drift.lock`. On a small repository with 42 route files, 38 of them wrapped in `withAuth()` (and 60 unrelated helper functions), the output is:

```
Drift read 103 files of TypeScript and JavaScript. Nothing left this machine.

What the code does (read from the code: facts, not rules)
  42 http entry points
    sign-in:     wrapped in withAuth in 38; other ways in 1; nothing found in 3 (of 42)
    permissions: nothing found in 38 (of 38 where a caller is or may be signed in)
    errors:      left to the framework in 42 (of 42)
    responses:   built with Response.json in 42 (of 42)

Worth a look first
  1. sign-in: no guard found in what Drift read, in 3 places (e.g. app/api/r38/route.ts:1 GET); make the usual way the rule for new code: drift practices promote P-0f0acb --in .
  `drift security` lists every entry point with its guard and what it reaches. `drift practices promote --list` lists the practices you can make a rule for new code.

Conventions
  1 proposed (1 default tier, 0 suggestions). Nothing is checked and no agent is told of one until you decide (`drift review`); an accepted convention advises unless you set it to block.

Default tier: block candidates, each reaches agents once you accept it, and may block once accepted (`drift review`, b)

 1. [D-37416b] HTTP handlers in app/** (route files) are wrapped in withAuth()
    evidence: 38/42 (lower bound 0.78, lift 2.5)
    tier:     default
    agents:   not shown to agents (block candidate: reaches agents once you accept it)
    example:  app/api/r00/route.ts#GET
    outlier:  app/api/health/route.ts:1 GET
    outlier:  app/api/r38/route.ts:1 GET
    outlier:  app/api/r39/route.ts:1 GET
    ... 1 more outliers

Wrote .drift/conventions.yaml and drift.lock (4 existing violations recorded, so only new ones are reported).

Next
  drift review               accept or reject the 1 proposal
  drift practices            the whole map, with a file to copy for each way
  drift security             entry points, their guards and the risky operations they reach

Tip: add `drift.lock merge=union` to .gitattributes so branches never conflict on the lock.
```

Read it top to bottom:

- **`What the code does`** is read from the code and is there whether or not Drift proposes anything: each kind of entry point, how many of them sign a caller in and how, check permissions, handle errors and answer. Each line adds up to its total: `nothing found` is what Drift read to the end and found no guard in, `could not tell` is what it could not read. These are what the code does, and nothing checks them until a person promotes one (step 7 below). See [Practices Map](Practices-Map).
- **`Worth a look first`** is at most five things from that map, the costliest first: a signed-in caller reaching what is not theirs, entry points with no sign-in, input nothing validates, two ways of doing one thing side by side.
- **`Conventions`** is what Drift proposes to check from now on. On many repositories this is short or empty, and the two sections above are the first result.
- **`Security baseline`** appears where the repository has no `.drift/security.lock` and the security inventory finds something: `Security baseline: none yet. It would hold N findings (n kind, ...), accepted as they are; new ones are reported by `drift check`. `drift security --write-baseline` writes it (.drift/security.lock); nothing was written.` `Next` then has the line `drift security --write-baseline   accept the N security findings as they are; `drift check` then reports new ones`. Writing it is your decision; once it is committed, `drift check` fails on a new finding of a kind it sets to fail ([Security Inventory](Security-Inventory#the-baseline-what-is-there-is-accepted-what-is-added-is-seen)).
- **`Next`** lists only the commands that have something to do in this repository.

`drift init --explain` prints the same screen and then the long account: what the show policy kept back and why, and a line per package in a monorepo.

Read the card like this:

- **`D-37416b`** is the convention's id. Keep it: every later command names conventions by id.
- **`evidence: 38/42`** means 38 of the 42 members of the role follow the rule. The lower bound is a 95% Wilson lower bound on that share, and the lift says how much more common the pattern is in this role than in the rest of the repository.
- **`tier: default`** is the stronger of the two tiers. Default-tier proposals are *block candidates*: they are listed first, and they reach no agent until you accept them. See [Conventions and Review](Conventions-and-Review).
- **Outliers** are the members that do not follow the rule today. They are baselined in `drift.lock`, so they never fail a check; only new violations do.

Everything starts as a proposal. A proposal is not checked at all.

If Drift proposes nothing, it says why and names the largest role it saw:

```
No conventions found: roles need roughly 20+ similar symbols where one pattern clearly dominates and is rarer elsewhere; the largest role here has 42 members (HTTP handlers in app/api/** (route files)).
```

That is normal on small or uniform repositories. The same run still leads with what the practice map knows; see [Practices Map](Practices-Map).

### If `drift init` says "No conventions shown" and that candidates were kept back

Mining can find a card and still not propose it: the show policy withholds cards whose kind has a weak track record or that have more than one outlier. When every card found is withheld, `drift init` says so, and `drift review` has nothing to show. Its `Next` block then names `drift review --hidden`, which lists them; `drift review --hidden --answer <id>=same` promotes one, and a promoted card whose rule family is below the admission bar reaches agents only after `drift review --show-to-agents <id>`:

```
Drift read 100 files of TypeScript and JavaScript. Nothing left this machine.

Conventions
  No conventions shown: Drift found 1 candidate and none has a track record strong enough to propose. `drift review --hidden` shows it with the evidence, for you to decide.

Wrote .drift/conventions.yaml and drift.lock (no existing violation to record).

Next
  drift review --hidden      the 1 weaker candidate, with the evidence
  drift init --explain       what was kept back and why

Tip: add `drift.lock merge=union` to .gitattributes so branches never conflict on the lock.
```

`drift init --explain` adds which cards were withheld and why (`drift census` prints the same two lines):

```
Explained
1 mined card(s) withheld by the show policy (not proposed; not shown as conventions to agents, hooks, MCP, exports or SARIF; `drift card <file>` states the strong ones as facts, not rules): TypeScript naming 1 (too many outliers (more than 1)). `drift review --hidden` lists them for people, with their evidence; a person can promote one.
Next for the 1 withheld card(s): `drift review --hidden` lists them with their evidence, and `drift review --hidden --answer <id>=same` promotes one. A promoted card whose rule family is below the admission bar reaches agents only after `drift review --show-to-agents <id>`.
```

On one 5,858-file monorepo this was the whole first result: 12 mined cards, all withheld. A withheld card is not a convention: nothing checks it and no agent is told it. You can still decide on it yourself, in three steps. The example is a repository with 40 files in `src/workers/`, 38 of them exporting a function named `*Worker`.

List the withheld cards, with their evidence:

```bash
drift review --hidden
```

```
[D-59eaf5] functions in src/workers/** are named `*Worker`
  evidence: 38/40 (lower bound 0.83, lift 2.5)
  tier:     suggestion (rule kind named)
  withheld: too many outliers (more than 1) (TypeScript naming)
  agents:   a fact on `drift card`, not a convention, while withheld; if promoted, not shown to agents (family below admission bar: 56% of 37)
  example:  src/workers/k0.ts#w0Worker
  outliers: 2 in the code now
    src/workers/k38.ts:1 w38Thing
    src/workers/k39.ts:1 w39Thing
  promote:  `drift review --hidden --answer D-59eaf5=same` (accept), `D-59eaf5=different --set-apart PATHS` (accept, those files set apart) or `D-59eaf5=not-a-convention` (reject)
```

Read the outliers as you would on any card. If the card is right, promote it. The answers are:

| Answer | Effect |
| --- | --- |
| `ID=same` | Accept it: "yes, these are the same kind of thing". |
| `ID=different --set-apart PATHS` | Accept it, with those files (comma-separated) set apart as a different kind of thing: `drift check` exempts their members by path. |
| `ID=not-a-convention` | Reject it. |

```bash
drift review --hidden --answer D-59eaf5=same
```

```
D-59eaf5: the same kind of thing: accepted
D-59eaf5: promoted from the withheld cards: in .drift/conventions.yaml as accepted by you (promoted_from_hidden: true), its current outliers baselined in drift.lock. It now follows the normal tier and agent rules: not shown to agents (family below admission bar: 56% of 37).
1 accepted (0 block), 0 proposed, 0 rejected (1 accepted not shown to agents: rule family below the admission bar)
```

The promoted card is accepted, in advise mode, and `drift check` now reports new violations of it. It does not yet reach agents: a suggestion (every Python convention is one, and so is any card below the admission bar for its rule family) is shown to agents only when you say so.

```bash
drift review --show-to-agents D-59eaf5
```

```
D-59eaf5: shown to agents (a person chose to show it: `agents: show`)
1 accepted (0 block), 0 proposed, 0 rejected
```

Commit `.drift/conventions.yaml` and `drift.lock`. Only promote a card you would tell a new teammate. If `drift review --hidden` prints `No mined card is withheld`, the repository has no convention to learn yet; `drift practices`, `drift security` and `drift card` still work without one.

## 4. Answer the setup questions, if there are any

When the `Next` block `drift init` ends with lists `drift setup` (questions only you can answer), run it. If it has nothing to ask it says so:

```
Nothing to ask: Drift has no question only you can answer.
```

The questions and what each answer changes are on [Setup Questions](Setup-Questions).

## 5. Decide: `drift review`

```bash
drift review
```

In a terminal, review goes one card at a time: `y` accepts it (advise mode), `b` accepts it and sets it to block, `a` accepts it and shows it to agents, `n` rejects it, `s` skips it, `q` quits. Start with the block candidates, and read their outliers: if the outliers are mistakes, accept; if every outlier is a legitimate, different kind of member (a test helper, a config file), reject the card or mark those members fine. Do not accept in bulk.

`drift review` with no flags needs a terminal. Without one it prints `drift review needs a terminal; use --accept/--reject/--block/--advise in scripts (--list prints the cards)` and exits 2. In a script, pass the ids:

```bash
drift review --accept D-37416b
```

Accepting is not the same as telling agents. Agents are shown an accepted default-tier convention. They are shown an accepted suggestion only when its rule family is admitted (none is today) or when you show it with `--show-to-agents`. Every Python convention is a suggestion. Each card's `agents:` line says which case it is, and the closing count line of `drift review` says how many accepted conventions agents are not shown. To accept a suggestion and show it to agents in one step:

```bash
drift review --show-to-agents D-04385a
```

`drift review --list` prints the cards without changing anything. Details, including exceptions and the "are these the same kind of thing?" question, are on [Conventions and Review](Conventions-and-Review).

## 6. Check: `drift check`

```bash
drift check
```

With `D-37416b` accepted (advise mode) and a new route that lacks the wrapper, the check reports it and exits 0:

```
drift: 1 new violation(s) (4 legacy, baselined)
[D-37416b] HTTP handlers in app/** (route files) are wrapped in withAuth() (38/42)
  at   app/api/new/route.ts:1 GET
  like app/api/r00/route.ts#GET
  mode advise
Advice: follow a convention where it fits the code; where it does not, no action is needed (no change, no comment). Wrong convention: `drift review --reject <id>`.
```

It then adds a section of practice departures (facts, not rules, which never fail the check). After `drift review --block D-37416b`, the same check exits 1. `drift check --strict` exits 1 on any new violation, advise mode included. Exit code 2 is an error, for example no `.drift/conventions.yaml` (run `drift init` first) or a policy file that does not parse. [Drift in CI](Drift-in-CI) has the full exit-code table.

To suppress one violation on purpose, put `// drift-ignore D-37416b: <reason>` (`#` in Python) directly above the declaration. A reason is required, and suppressions are counted so reviewers see them.

## 7. Make a practice the rule

`What the code does` at the top of `drift init` is the practice map: facts about the code, which nothing checks. When one of them is the rule you want for new code, promote it. This takes one command and does not depend on what mining proposed.

The example is the sample repository in the [README](https://github.com/dadbodgeoff/drift/blob/main/README.md#a-five-minute-first-run) (built by `npm/dry-run.sh`): 40 route files in `app/api`, 38 wrapped in `withAuth`. List what may be promoted:

```bash
drift practices promote --list
```

```
3 practice(s) may be promoted now. Each becomes an accepted convention in advise mode, with the code that differs today recorded in drift.lock; the command prints what it records (--dry-run writes nothing):
  sign-in in .: wrapped in withAuth in 38 of 40 entry points; 2 differ, 0 could not be read
    drift practices promote P-0f0acb --in .
  errors in .: left to the framework in 40 of 40 entry points; 0 differ, 0 could not be read
    drift practices promote P-6123b9 --in .
  responses in .: built with Response.json in 40 of 40 entry points; 0 differ, 0 could not be read
    drift practices promote P-9fdb90 --in .
```

See what promoting sign-in in `app/api` would write, without writing it:

```bash
drift practices promote P-0f0acb --in app/api --dry-run
```

```
Sign-in in app/api: wrapped in withAuth in 38 of 40 entry points.
  2 do not, and are recorded as they are (app/api/r38/route.ts:1 GET, app/api/r39/route.ts:1 GET).
  0 could not be read; those are never reported.
From now on `drift check` reports a new entry point here that does it another way, or not at all.
Mode: advise (it never fails a check). `drift practices promote P-0f0acb --in app/api --block` makes it fail one, when the 15 entry points added here most recently follow it.
Also in .drift/conventions.yaml: D-37416b names the same way for code of this package. Where both are accepted, new code that breaks them is reported under each; `drift review --reject <id>` drops one.
Dry run: nothing was written.
```

Then promote it:

```bash
drift practices promote P-0f0acb --in app/api
```

It ends with `Wrote .drift/conventions.yaml and drift.lock.` The convention is accepted, in advise mode, and shown to agents. The 2 routes that do not use `withAuth` today are recorded in `drift.lock`, so `drift check` reports only a new route in `app/api` that signs the caller in another way, or not at all. A route Drift cannot read is never reported. Commit `.drift/conventions.yaml` and `drift.lock`.

On this sample, `drift init` also proposed the mined `D-37416b`, which says much the same by name. They are two conventions: keep one, or both. Block mode, `--with`, `--force` and what qualifies are on [Practices Map](Practices-Map#promoting-a-practice-to-a-convention). Interactive `drift review` offers the same step after the proposals.

## 8. Look around

These read-only commands show what Drift knows beyond conventions:

```bash
drift practices
```

```bash
drift security
```

```bash
drift card app/api/search/route.ts
```

`drift practices` is the per-route practice map, `drift security` the entry-point inventory, and `drift card <file>` one file's place in the repository (the same thing an agent reads before it edits). The Studio shows all of it in a desktop window: from a checkout, `npm ci` then `npm run start -w drift-studio`, with `drift` on your `PATH`.

## What was written to disk

After `init`, `review` and a few commands:

| Path | What it is | Commit it? |
| --- | --- | --- |
| `.drift/conventions.yaml` | the policy: every proposal and your decisions, with evidence | Yes |
| `drift.lock` | legacy violations that never block, one `<id> <path#symbol>` per line | Yes |
| `.drift/config.yaml` | your answers and settings (written by `drift setup`, or by hand); absent until you need it | Yes |
| `.drift/cache/` | the fact cache, derived results and agent session state; it contains its own `.gitignore` (`*`) | No, it ignores itself |
| `.drift/review-log/` | the opt-in review log (`drift review --set-log on`); it contains its own `.gitignore` (`*`) | No, it ignores itself |
| `.drift/findings/`, `.drift/gap-reports/` | what an agent found with `drift investigate`; only after an agent records a finding or a gap report; they contain their own `.gitignore` (`*`) | No, they ignore themselves |
| `.drift/verify-cache.json` | verdicts of the experimental agent verifier, only with `agents.verify: on` in `.drift/conventions.yaml` | No; Drift does not ignore it for you, so add it to `.gitignore` if you use the verifier |

Commit the policy so teammates and CI get the same rules and answers:

```bash
echo "drift.lock merge=union" >> .gitattributes
```

```bash
git add .gitattributes .drift/conventions.yaml drift.lock
```

If `drift setup` wrote `.drift/config.yaml`, add that file too: it holds your answers, and teammates and CI should get the same ones.

`merge=union` lets parallel branches both add lines to the lock without a conflict. Drift only ever removes lines from the lock by fixing code, and people add them, which is what makes the union merge safe. The complete list of files, by command, is on [Files Drift Writes](Files-Drift-Writes).

## Next

- Hook Drift into your agents: [Using Drift with Agents](Using-Drift-with-Agents).
- Check pull requests: [Drift in CI](Drift-in-CI).
- Roll it out to a team: [Team Rollout](Team-Rollout).
- Something looks wrong: [Troubleshooting](Troubleshooting).

See also: [How Drift Works](How-Drift-Works), [Conventions and Review](Conventions-and-Review), [Command Reference](Command-Reference), [Files Drift Writes](Files-Drift-Writes).
