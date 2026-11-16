# Team Rollout

This page is an adoption plan for a team: who runs `drift init`, what to commit, how to review proposals together, who owns the policy files, how to keep answers current, and how to onboard new members. It is for the engineering lead or platform owner who introduces Drift to a repository that several people and several agents work in.

The plan is conservative on purpose. Drift's mined conventions were about half right on repositories it was not tuned on, and its `none` and `internal` answers need checking (see [Accuracy and Limits](Accuracy-and-Limits)). So the plan starts with advice, puts a person's judgement in front of every rule, and turns on blocking last, one convention at a time.

## What is shared and what is local

| Path | Shared through git? | Why |
| --- | --- | --- |
| `.drift/conventions.yaml` | Yes | the policy: teammates, CI and agents get the same rules and decisions |
| `drift.lock` | Yes | the legacy violations that never block, so CI and teammates agree on what is "new" |
| `.drift/config.yaml` | Yes | your setup answers, `practices:` declarations, `security:` settings, package overrides |
| `.gitattributes` line `drift.lock merge=union` | Yes | parallel branches never conflict on the lock |
| `.drift/cache/` | No; it ignores itself | the fact cache, derived results and agent session state are local |
| `.drift/review-log/` | No; it ignores itself | the opt-in review log is local |
| `.drift/findings/`, `.drift/gap-reports/` | No; they ignore themselves | what an agent found while investigating: local, never posted |
| `.drift/verify-cache.json` | No; add it to `.gitignore` | verdicts of the experimental agent verifier (`agents.verify: on` in `.drift/conventions.yaml`); Drift does not ignore it for you |
| `AGENTS.md` or `CLAUDE.md` block from `drift export agents-md` | Yes, if you use it | one generated block, regenerated after reviews |

`drift investigate` writes local findings under `.drift/findings/` and local gap reports under `.drift/gap-reports/`. Each directory ignores itself and nothing posts or shares them; do not commit them. The full file list is on [Files Drift Writes](Files-Drift-Writes).

## The plan

### Week 0: decide and prepare

1. **Choose one owner** for the Drift policy (see "Ownership" below) and one repository to start with.
2. **Agree the rules of use:** advise-first, nothing blocks until a named person sets it to block, and review is never done in bulk.
3. **Install the same Drift version** for everyone and for CI, and record it. The policy file records the engine version that wrote it (`engine:` at the top of `.drift/conventions.yaml`). Pin the Action's `drift-ref` to a tag or commit. This matters most before the first promoted practice: a Drift from before promotion cannot read the policy file once one is in it. See [Versioning and Upgrades](Versioning-and-Upgrades#promoted-practices-and-older-drift).

### Week 1: one person runs `drift init`

On an up-to-date main branch, with a clean working tree, at the repository root (monorepos included: one `.drift/` at the root):

```bash
drift census
```

```bash
drift init
```

Running `census` first is optional; it previews and writes nothing. `drift init` writes the proposals (all `proposed`: nothing is checked, shown to agents, or able to block) and baselines today's violations in `drift.lock`.

Do not commit yet. If `drift init` says nothing was proposed, that is a normal outcome on a small or uniform repository; the practice map and the security inventory still work, and you can skip to "Answer setup once".

### Week 1: review together

Run `drift review` in a short meeting, or have the owner review and others comment on the pull request that commits the policy.

- **Default tier first** (block candidates). For each, read its outliers. If they are mistakes, accept. If every outlier is a legitimate, different kind of member, reject the card or mark those members fine with a reason (`--exempt`), or set them apart.
- **Suggestions after.** Only the 5 best are listed by default. Accept the ones a reviewer on your team would want an agent told, and show those to agents with `drift review --show-to-agents <id>` (accepting alone does not), and ignore the rest: a proposal left alone costs nothing.
- **Accept in advise mode** (`y`, or `--accept`). Do not set anything to block yet.
- **Do not show suggestions to agents** (`a`) unless you would stand behind them.

Then commit:

```bash
echo "drift.lock merge=union" >> .gitattributes
```

```bash
git add .gitattributes .drift/conventions.yaml drift.lock
```

```bash
git commit -m "Adopt Drift: accepted conventions and baseline"
```

### Week 1: answer setup once, and commit it

If `drift init` ended with "N questions only you can answer", have someone who knows the deployment answer them once:

```bash
drift setup
```

Typical answers: which compose files are test stacks, which Terraform target group serves which service, whether a helper is your tenant check. Commit `.drift/config.yaml` so everyone and CI get the same answers. Review each answer in the pull request: a wrong "tests-only" hides real exposure, and a wrong "yes, this is our check" makes a route read `known` that is not. An agent may propose answers; a person confirms them (`drift setup --review`). See [Setup Questions](Setup-Questions).

### Week 2: CI in advice mode

Add the Action (or run `drift check` in your pipeline); see [Drift in CI](Drift-in-CI). With every convention in advise mode, nothing fails; the annotations show reviewers what a pull request introduces. Leave it this way for a while and watch which advice people act on and which they ignore. Reject conventions that produce only ignored advice (`drift review --reject <id>`).

### Week 2 onward: agents

Install the plugin and register the MCP server for those who use Claude Code, and add the generated agents block to `AGENTS.md` (`drift export agents-md --write AGENTS.md`), then commit it. Agents hear only about conventions a person accepted, and about an accepted suggestion only if its rule family is admitted or a person ran `drift review --show-to-agents <id>` (every Python convention is a suggestion). See [Using Drift with Agents](Using-Drift-with-Agents).

### Week 2 onward: make a practice the rule, where you agree with it

`drift practices` shows what the code does for sign-in, permissions, validation, errors and responses, and agents are already told these practices as facts (the recipe before a new entry-point file, a note after an edit that departs from its neighbours). A fact does not hold anyone to anything: nothing checks it, and CI never reports it.

Promoting a practice is what turns one into a rule. It writes an accepted convention for one place, and from then on `drift check`, CI and the pre-commit hook hold new code there to it, while the code that already differed is recorded in `drift.lock`. Because a person promoted it, it is also shown to agents as a rule, not only as a fact.

- **List what qualifies:** `drift practices promote --list` (or interactive `drift review`, which offers each after the proposals). Only places where one way holds at least 80% of at least 8 readable units, with at most 20% unknown, qualify.
- **Decide as you would on a mined card.** Read the units the preview says differ (`--dry-run`). Promote the ones you would tell a new teammate; answer `n` in `drift review` to the ones you would not, and it is not offered again.
- **Advise first**, as for every convention. Each promotion is a pull request to `.drift/conventions.yaml` and `drift.lock`, reviewed by the policy owner.
- **Upgrade everyone and CI first** (Week 0, point 3).

Details: [Practices Map](Practices-Map#promoting-a-practice-to-a-convention).

### Later: turn on blocking, deliberately

Set a convention to block only when you would reject the same violation in code review, its outliers have been reviewed, and it has been quiet in advice mode for long enough that you trust it:

```bash
drift review --block D-37416b
```

Only default-tier conventions in roles of 15 or more members can be set to block without `--force`, and a block-mode convention in a smaller role is treated as advise. A promoted practice is set to block with `drift practices promote <P-id> --in <place> --block`, which Drift allows only when, of the 15 units most recently added to the place, at least 80% follow it; it needs git history, and a Python place advises only. Each blocking decision is a pull request to `.drift/conventions.yaml`. `drift review --advise <id>` is the way back.

## Ownership

Treat `.drift/conventions.yaml`, `drift.lock` and `.drift/config.yaml` as policy, not generated output:

- **Name an owner** (a person or a small group), and require their review of changes to these files, for example with a `CODEOWNERS` entry. Drift does not enforce this; your repository host does.
- **Agents cannot edit these files.** The hooks deny edits to `.drift/` and `drift.lock`, including shell commands that write there, best effort. `drift setup` lets an agent propose, never decide, any answer that would make Drift say more.
- **Review `drift.lock` changes.** Lines are added by people (at `init`, and when a person promotes a practice) and removed by fixing code. A pull request that adds lock lines is baselining new violations and deserves the same scrutiny as a new `drift-ignore`.
- **Count suppressions.** `drift check` counts `drift-ignore` comments, and the pull-request summary lists the ones a change adds.

If two branches change `.drift/conventions.yaml` at once, Drift has no merge tool for it: resolve it like any YAML file (keep both sides' decisions; ids are stable), then run `drift review --list` or `drift check` to confirm the file still parses. A file that does not parse stops the commands that read it with exit 2. `drift.lock` needs no resolution when you use `merge=union`, because lines are only added by people and removed by fixing code.

## Keeping answers current

- **New proposals.** Re-run `drift init` now and then (a repository changes). It keeps every decision and id and only adds new proposals, which you review as before. After a Drift upgrade, `drift init --refresh-kinds` relearns the file-kind vocabulary frozen in the conventions file; existing conventions keep their ids but the files their roles cover may change, so review the diff.
- **Setup answers.** Re-run `drift setup` after changing deployment files (compose, Terraform): it asks only what is new or whose evidence changed. `drift setup --all` asks everything again.
- **Declarations.** Re-run `drift practices --hints` to see whether a `practices:` line is still needed, and re-read the ones you have: a declaration is your statement, and it does not notice the code changing under it.
- **The lock.** It only shrinks as people fix legacy code. Do not regenerate it to silence a failing check.

Not built yet: a report of answers that have gone stale because the evidence they rested on changed. Today `drift setup` asks again a person's answer whose evidence changed, but the old answer keeps applying until someone answers; an agent's cautious answer is judged again on every read (see [Setup Questions](Setup-Questions#what-the-questions-rest-on)). Keeping answers current is manual, as above. A useful habit meanwhile: now and then have an agent work through `drift investigate`, and confirm what it proposes in `drift setup --review`.

## Onboarding a new team member

1. Install Drift (the same version as CI; see [Getting Started](Getting-Started)).
2. Clone. There is nothing to run: `.drift/conventions.yaml`, `drift.lock` and `.drift/config.yaml` come with the repository, and the cache builds itself on first use.
3. Try the read-only commands: `drift check`, `drift card <a file you are about to change>`, `drift practices`, `drift security`.
4. If they use an agent, install the plugin and register `drift mcp`.
5. Point them to this wiki's [Conventions and Review](Conventions-and-Review) page for how to propose a change to a rule: open a pull request that edits `.drift/conventions.yaml` (usually through `drift review`), owned by the policy owner.

## Measuring whether it is working

Drift's own evaluation found that most repositories get few conventions: about one card shown per TypeScript or JavaScript repository, and about 0.6 accepted, with a median of zero. Do not judge the rollout by the count of conventions. Judge it by whether the advice people receive is acted on, whether the practice map and security inventory answer questions people actually ask, and whether the `unknown` count falls as you answer setup questions and declare checks you have verified. The opt-in review log (`drift review --set-log on`) records decisions locally if you want your own accept rate.

See also: [Getting Started](Getting-Started), [Conventions and Review](Conventions-and-Review), [Setup Questions](Setup-Questions), [Drift in CI](Drift-in-CI), [Using Drift with Agents](Using-Drift-with-Agents), [Security and Privacy](Security-and-Privacy).
