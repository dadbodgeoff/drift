# FAQ

Short answers to the questions people ask most when they evaluate or adopt Drift, with links to the pages that hold the detail. It is for engineers, leads and reviewers who want the answer first and the explanation second.

## About the tool

**What is Drift in one sentence?**
A command-line tool that reads a repository and tells people, agents and CI which conventions the code follows, what it does per route for authentication, authorization, errors and more, and which entry points are guarded and who can reach them. See [Home](Home).

**Does it use AI or a model?**
No. The check path runs no model and makes no model call. The conventions, practice map and security inventory are computed from your code by deterministic analysis. Output is byte-identical across runs, thread counts and operating systems. The experimental agent verifier (off by default) asks the host agent to run a frozen prompt and send replies back; Drift itself makes no model or network call. See [How Drift Works](How-Drift-Works).

**Does it send my code anywhere?**
No. No command of the binary uses the network, and there is no telemetry. The one route for repository text to leave is an agent you connect: hook and MCP output is text in that agent's context. See [Security and Privacy](Security-and-Privacy).

**Does it change my code or my git history?**
No. It never edits source files and never runs `git commit`, `add`, `checkout`, `fetch`, `push` or `stash`. It writes under `.drift/`, to `drift.lock`, and to files you name with `--write` or `--out`. See [Files Drift Writes](Files-Drift-Writes).

**Which languages does it read?**
TypeScript, JavaScript and Python. See [Languages and Frameworks](Languages-and-Frameworks).

**Do I need git?**
For most commands, no: they read the working tree (a repository without git works, with the hooks taking every current violation as the baseline). Pull-request mode (`--diff-base`) needs a git work tree and the merge base in the local history. See [Drift in CI](Drift-in-CI).

**Does it read git history?**
Not for conventions, the practice map or the security inventory: those read the working tree. It reads git for `--diff-base`, for the hooks' baseline, and (only for the experimental `wiring` rules) for which files change together. See [Security and Privacy](Security-and-Privacy).

**What state is it in?**
Beta. The development version reads `0.1.0-dev`; no release has been published yet, and the Studio is not packaged. See [Getting Started](Getting-Started) and [Versioning and Upgrades](Versioning-and-Upgrades).

**What license?**
Apache-2.0.

## Accuracy

**How accurate is it?**
It depends on what you ask. Exposure and error handling are in good shape. For authentication and authorization, `known` is proven, but on unseen code a share of `none` answers (and some `known`) are wrong. Mined conventions: about half of the default-tier cards (7 of 15) were right out of sample. See [Accuracy and Limits](Accuracy-and-Limits).

**What does `unknown` mean? Is it a bug?**
It is the honest answer where Drift cannot prove something, and it says what it did not read. It is not a defect. See [How Drift Works](How-Drift-Works) and [Troubleshooting](Troubleshooting).

**Can I trust `none`?**
Read it as "nothing found in what Drift read": a finding to check, not a fact. The same goes for `internal`. Drift words both that way everywhere ("no guard found in what Drift read", "internal in what Drift read") and lists what it saw and did not read beside each, so you know where to look first.

**Can I trust a convention it proposes?**
Not without review. Look at the outliers, accept only what you would defend in code review, and expect to reject some. Do not accept in bulk. See [Conventions and Review](Conventions-and-Review).

## Using it

**Why did `drift init` propose nothing?**
A convention needs a role of roughly 20 or more similar symbols where one pattern dominates. Small or uniform repositories often get none; Drift says so and names the largest role it saw. The practice map and the security inventory still work. See [Troubleshooting](Troubleshooting).

**What should I commit?**
`.drift/conventions.yaml`, `drift.lock`, and `.drift/config.yaml` if it exists; add `drift.lock merge=union` to `.gitattributes`. Do not commit `.drift/cache/` or `.drift/review-log/` (each ignores itself), or `.drift/verify-cache.json` if you use the experimental verifier (it does not ignore itself; add it to `.gitignore`). See [Getting Started](Getting-Started) and [Team Rollout](Team-Rollout).

**Will it block my commits or my CI?**
Only for conventions a person set to block. After `drift init` every proposal is inactive; accepting puts a convention in advise mode; blocking is a separate, deliberate step. `drift check --strict` also fails on advise-mode violations. See [Drift in CI](Drift-in-CI).

**How do I suppress one violation?**
Put `// drift-ignore <id>: <reason>` (`#` in Python) directly above the declaration, with a reason. For a legitimate exception to a rule everywhere, mark the member fine with `drift review --exempt`. See [Conventions and Review](Conventions-and-Review).

**How do I exclude a directory?**
Drift respects `.gitignore` and `.ignore`, skips dependency and build directories, and does not mine or check tests, stories, fixtures and demonstration code. For package scope use `packages: {exclude: [...]}` in `.drift/config.yaml`. See [Configuration Reference](Configuration-Reference).

**Does it work in a monorepo?**
Yes. Run `drift init` once at the root; Drift finds the packages and mines each in its own scope, with one `.drift/` at the root. See [Conventions and Review](Conventions-and-Review).

**Is it a linter, a type checker or a security scanner?**
No. It checks what your code already does, and it reports security facts for a person to review. It is a guardrail, not a security control. It does not replace a linter, a SAST tool or a review.

**How is a convention different from a lint rule?**
A lint rule is something you write and the tool enforces. A convention is something Drift found your code already does, which you may accept; it advises by default and blocks only if you say so. If your linter already enforces the equivalent, Drift does not propose it.

**How do I turn blocking off again?**
`drift review --advise <id>` returns an accepted convention to advise mode. `drift review --reject <id>` rejects it.

**How do I remove Drift?**
Delete `.drift/` and `drift.lock`, remove the Drift entries from `.pre-commit-config.yaml` and your CI workflow, remove the generated block between the `drift:start` and `drift:end` markers from `AGENTS.md` or `CLAUDE.md`, remove any entries `drift export claude-settings --write` added to `.claude/settings.json`, and uninstall the plugin and MCP registration in your agent host. The `drift.lock merge=union` line in `.gitattributes` is the only other trace. Nothing else of Drift's lives in your repository.

## Agents

**What do agents see?**
Accepted conventions of the default tier, suggestions only if their rule family is admitted (none is today) or a person chose to show them, plus facts: a file's card, the practice recipe for a new entry-point file, and notes after an edit. Nothing a person has not accepted is shown as a rule. See [Using Drift with Agents](Using-Drift-with-Agents).

**Can an agent change the policy?**
No. The hooks deny agent edits to `.drift/` and `drift.lock` (shell commands that write there too, best effort). An agent may propose setup answers through `drift setup`, but any answer that would make Drift say more waits for a person to confirm. See [Setup Questions](Setup-Questions).

**Does it work with agents other than Claude Code?**
Through MCP, yes: `drift mcp` serves its tools over standard input and output for any MCP client. The hooks and the plugin are for Claude Code. `drift export agents-md` writes a generated block for `AGENTS.md` or `CLAUDE.md`, readable by any agent. See [MCP Reference](MCP-Reference).

**Will the hooks slow the agent?**
Mostly not: an edit of a file with no entry point costs about 0.2 s or less, and an edit of a file with entry points about 2 s on a 3,200-file monorepo (see [Hooks Reference](Hooks-Reference), "How long a hook takes"). See [Troubleshooting](Troubleshooting).

## Operating it

**Who should own `.drift/conventions.yaml`?**
A named person or small group, with their review required on changes, for example through `CODEOWNERS`. See [Team Rollout](Team-Rollout).

**What if two branches both change the policy?**
`drift.lock merge=union` handles the lock. For `.drift/conventions.yaml`, resolve it like any YAML file, keeping both sides' decisions (ids are stable), then run `drift check` to confirm it parses. See [Team Rollout](Team-Rollout).

**How do I keep answers current?**
Re-run `drift init` (it keeps decisions and adds new proposals) and `drift setup` (it asks what is new or changed) after significant changes. A person's answer whose evidence changed is asked again, but keeps applying until it is answered; a report of stale answers is not built yet (see [Setup Questions](Setup-Questions#what-the-questions-rest-on)). See [Team Rollout](Team-Rollout).

**Where is the Studio?**
A desktop app in `apps/studio`, run from a checkout (`npm ci`, then `npm run start -w drift-studio`). It is not packaged yet. It runs the `drift` binary and sends nothing anywhere. See [Security and Privacy](Security-and-Privacy).

**How do I report a bug or a vulnerability?**
A bug: through the repository's issues. A vulnerability: privately, through the Security tab ("Report a vulnerability"), not a public issue.

See also: [Home](Home), [Getting Started](Getting-Started), [Accuracy and Limits](Accuracy-and-Limits), [Troubleshooting](Troubleshooting), [Glossary](Glossary).
