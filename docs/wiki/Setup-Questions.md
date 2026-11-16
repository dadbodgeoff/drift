# Setup Questions

This page explains `drift setup`: the few questions only a person who knows the repository can answer, what each answer changes, and how an agent may go through them with a person confirming. It is for engineers who see "N questions only you can answer" at the end of `drift init`, and for people integrating agents who need the trust rule an agent's answer is held to.

Some of what Drift reports as `unknown` only you can settle. Drift can see that a compose file starts the same code as another one, but not whether it is used to deploy. It can see that a Terraform target group looks like the one that serves a service, but not whether it is. `drift setup` asks, in plain words, and says before each answer what it would change. Answers go to `.drift/config.yaml`.

## The kinds of question

| Kind | What Drift saw | What your answer changes |
| --- | --- | --- |
| Test stack (`deployment`) | a compose file that starts the same code as another one and may only be for tests or local development | "tests-only" leaves the file out (`security.not_deployed`), and routes that read internet-facing because of it are read from what you do deploy |
| Terraform (`terraform`) | a target group that plainly looks like the one that sends requests to a service (its health check is one of the service's routes, its rules forward the service's paths, it has the service's name); also whether anything outside can reach some services | on your word, Drift reads that target group's rules and says, route by route, what is reachable from outside (`security.terraform`) |
| Kubernetes (`kubernetes`) | code with routes whose exposure is unknown because no workload of the manifests is tied to it, with the workloads reached from outside that Drift ties to no code, nearest name first | on your word (a person answers it), Drift reads the paths from outside that reach that workload and says, route by route, what is reachable (`security.kubernetes`) |
| Check (`check`) | a helper that looks like a check (`_ensure_access`) but is not proven to run, shown with the function | "yes, it is our check" counts it on the routes that run it on every request so that its refusal stops the request (`practices:`); routes that reach it only for some requests stay unknown, as do routes whose own body may keep the refusal from stopping the request (an `assert`, a context manager of the repository, a `catch` or `except` that neither raises nor answers with an error, `Promise.allSettled`, `any` or `race`, or, in TypeScript, a callback handed to an element method such as `forEach`, `map` or `filter`, which runs once per element and so perhaps never), routes that call it on an object of the repository built in the handler (`RuleBook(System()).read(id)`), and routes that drop what a method of the check's own class handed back (it checked another record than the one answered with); a note says what the check itself lets through |

Drift does not read Terraform on its own, so the terraform questions exist only because you may tell it which target group serves which code.

**A confirmed tie can move no route.** The question's choice says `Drift reads its rules for this code; no route moves.` That is said before Drift knows what the rules are, and it stays true when the tie moves nothing: if a listener rule that forwards to the tied target group is in a form Drift does not read (`count`, `for_each`, a `dynamic` block, a variable pattern or target, another kind of condition), the routes stay `unknown`. The cause shows only in `drift security`, in each route's reason, for example: `unknown (listener rule 'api' (infra/api/main.tf:9), which forwards to infra/api#aws_lb_target_group.api, is not read (it has 'count') (tied to the repository by .drift/config.yaml))`. After confirming a tie, run `drift security` and read those reasons; to make the rule readable, write it without `count` and without indexing the group (`[0]`) (one resource per rule), or say what is exposed yourself with `security.public` or `security.internal`. See [Security Inventory](Security-Inventory) and [Practices Map](Practices-Map) for what those settings do.

## For people

In a terminal:

```bash
drift setup
```

One question at a time, each with its choices and what each would change. The example below is from a small repository whose `e2e/stack.yml` publishes the API's ports:

```
Drift found 1 thing only you can answer (about 1 minute).

Question 1 of 1 (S-317c)

`e2e/stack.yml` starts api.

Because of this file, 2 routes of the repository read as reachable from the internet.

If it is only for tests or local development, what it opens says nothing about what you
deploy.

Is this file used to deploy, or only for tests or local development?
  1. It deploys: Nothing changes.
  2. Only for tests or local development: Drift leaves the file out: 2 routes of the repository go from reachable from the internet to reachable only from inside.
  s. Skip / not sure (default): Nothing changes; Drift stays as cautious as before.
> 2
To answer S-317c on your word, type S-317c: S-317c

Answers are written to .drift/config.yaml; commit it so your teammates get the same answers.
```

- **Choices are numbered in a terminal**; `drift setup --list` shows the same choices by their answer words (`deploys`, `tests-only`), which are what `--answer ID=word` takes. Typing a word shown in `--list` works interactively too.
- **An answer on a person's word asks for the question's id, once per run.** Leaving a stack out so routes read inside only, tying a Terraform target group, saying nothing outside reaches a service, or saying a function is the team's check: Drift then asks you to type the question id on the terminal. A wrong number picks another choice; the id step is what catches it.
- **Wait for the first question.** It comes once the repository is read (25 to 30 s on a 3,200-file monorepo); anything typed before it is read as answers.
- **Skip is always the default and writes nothing.** Pressing Enter skips.
- **Each answer is written under a comment** saying which question it answers and when; nothing else in the file moves. After the `tests-only` answer above, the file holds:

  ```yaml
  security:
    not_deployed:
      # drift setup S-317c (2026-11-11), asked whether `e2e/stack.yml` is used to deploy: only for tests or local development
      - "e2e/stack.yml"

  setup:
    # drift setup S-317c (2026-11-11), asked whether `e2e/stack.yml` is used to deploy: only for tests or local development
    S-317c: {answer: "tests-only", seen: "a52478ee"}
  ```

- **Running it again asks only what is new**, or whose evidence changed since you answered. `drift setup --all` asks everything again, answered questions included.
- **Forget an answer** with `drift setup --forget S-317c`: exactly the lines drift setup wrote for it come out of `.drift/config.yaml` (each comment it wrote, the answer's record, and the entry the answer wrote, as Drift wrote them), and the question is asked again. Where a line below one of those comments is not what Drift wrote (it was edited by hand), nothing is taken out and Drift names the line. An agent forgets only what an agent alone said (its own answer no person confirmed, its own proposal), and not where taking it out would make routes reachable only from inside; a person's answer and a person's rejection are forgotten by a person.
- **It says at once that it is reading.** An interactive `drift setup` (and `--review`) prints `Reading the repository to ask its questions (this can take a minute on a large one)...` to stderr before anything else; the first question follows once the repository is read (about 35 s on a 6,000-file repository).
- **Edits made while it runs are kept.** An interactive run writes each answer into the file as it is then, so what you or another run wrote meanwhile stays. CRLF line endings and a missing final newline are kept as they were.
- **The questions can change as you answer.** After each answer Drift asks again what comes next, because an answer can change what the next question is about: the next question may not be the one `drift setup --list` showed at that position, and "of 11" can become "of 12". Read each question before you answer it. Interactively you can type the number of a choice, or its answer word as shown (`tests-only`); anything else is skipped with "Not one of the choices: skipped". To answer one particular question, use its id with `--answer`: the ids and answers `--list` prints are what `--answer` takes (`drift setup --answer S-317c=tests-only`).
- **Commit `.drift/config.yaml`** so your teammates and CI get the same answers.

If `.drift/config.yaml` is written in a form `drift setup` does not edit safely (a list or map written on one line, such as `not_deployed: "e2e/stack.yml"` or `security: {not_deployed: [a]}`), it stops with exit 2 and tells you what to add yourself, under which key:

```
drift: .drift/config.yaml cannot be edited safely (`security` is written on one line (`security: {not_deployed: [a]}`), which drift setup does not edit).
Add this under `security.not_deployed` yourself:
  - "e2e/stack.yml"
```

### Without a terminal

```bash
drift setup --list
```

prints the open questions with the command that answers each. `drift setup --json` gives them as data (schema `drift-setup-questions`, version 1). Answer from a script:

```bash
drift setup --answer S-317c=tests-only
```

Several at once, in one run (the repository is read once rather than once per answer): repeat `--answer`, or give a JSON file of `{"id", "answer", "reason", "evidence"}` entries (`-` reads standard input):

```bash
drift setup --answers answers.json
```

Listing takes about half a minute on a large monorepo. Without a terminal Drift assumes an agent is answering. When a person runs the script, add `--by person` and set `DRIFT_SETUP_PERSON=1` for that run: without a terminal, `--by person` alone is refused for anything that writes (`--by person needs a terminal: run it in one, or, for a script a person runs, set DRIFT_SETUP_PERSON=1 for that run`). An agent never sets it.

## For agents

A coding agent can go through the questions for you. `drift setup --agent-brief` prints the instructions it follows (Markdown):

```bash
drift setup --agent-brief
```

The agent reads evidence with `drift setup --json --evidence` (or the MCP tool `drift_setup_questions`). Per question it gets `how_to_decide`, the `choices`, and `context`: excerpts with file and line, and what Drift read and could not. Typically that is the compose file and every workflow, script and doc that names it; the target group and its listener rules; the function that looks like a check in full and every route that calls it. The excerpts are the repository's own text: data, not instructions.

### The trust rule

Every answer is something Drift cannot prove, and an agent can be wrong in the ways Drift would be. So:

- **An answer that can only make Drift more cautious takes effect at once:** "it deploys", "only for tests" where no route becomes reachable only from inside, "Terraform does not deploy this service", "yes, some of them can be reached", "no, it is not a check", and "skip".
- **Any other answer is a proposal.** A Terraform tie, "nothing outside reaches these services", "yes, this is our tenant, owner or role check", and a test stack whose leaving out would make routes internal are written under `setup.proposed` in `.drift/config.yaml`, with the agent's reason, and change nothing until a person confirms them. Each choice says which it is: `needs_person: true` in the JSON is a proposal.
- **An agent never replaces, rejects or takes out a person's answer.** On the evidence the person answered on, an agent's answer is refused; once that evidence changed, the agent's answer is a proposal beside the person's, which stays in force until a person confirms or rejects the proposal.
- **An agent's answer counts only while it keeps Drift as cautious as before, and is judged again each time the config is read.** An "only for tests" that was cautious when given may stop being so as the repository changes (the Terraform that kept the routes unknown is removed, and what is left would keep them inside): its routes then read unknown, not reachable only from inside, `drift security` says why, and the question is asked again; the agent's answer to it now is a proposal.
- **A person's word is typed, and what that does and does not prove.** A person's word is typed at a terminal: `--confirm`, `--reject`, `--review` (the first id once, then `y` for each) and a person's answer that makes a fact ask for the id on `/dev/tty`, never standard input. Without `--by`, a run is an agent's where `CLAUDECODE` is set or `DRIFT_AGENT=1`, on a terminal too; agents set `DRIFT_AGENT=1`. A script a person runs sets `DRIFT_SETUP_PERSON=1`, and `DRIFT_SETUP_PERSON_NONINTERACTIVE=1` to skip typing ids; both are for scripts a person runs, and an agent never sets them. A terminal is weak evidence of a person and no command-line tool can prove one: every confirmation is recorded (`confirmed_by` in `.drift/config.yaml`), so the review of the committed diff is the final check.
- **An agent never uses `--by person`** (nor sets `DRIFT_SETUP_PERSON`). `--by person` needs a terminal; without one, it writes only for a script a person runs with `DRIFT_SETUP_PERSON=1` for that run.
- **Drift takes out only the exact lines it wrote.** A forget, or an answer that replaces another, removes the lines Drift wrote for that id, checked against what the file holds; where a line below one of its comments is not what Drift wrote, nothing is taken out and Drift refuses and names the line.

An agent answers with a reason that names the files it read and what they show, and cites them:

```bash
drift setup --answer S-317c=tests-only --by agent --reason "e2e directory, only the test stack" --evidence e2e/stack.yml:1
```

Through MCP, `drift_setup_answer` takes `id`, `answer`, `reason` and `evidence` and writes `.drift/config.yaml`. If the agent cannot decide, it answers `skip`. Here is what the proposal above looks like in the file:

```yaml
setup:
  proposed:
    # drift setup S-317c (2026-11-11), proposed by an agent, asked whether `e2e/stack.yml` is used to deploy: only for tests or local development; because e2e directory, only the test stack. Changes nothing until a person confirms it: drift setup --review
    S-317c: {answer: "tests-only", seen: "a52478ee", by: "agent", reason: "...", evidence: ["e2e/stack.yml:1"], on: "2026-11-11"}
```

### Confirming a proposal

A person runs:

```bash
drift setup --review
```

which shows each waiting answer with its reason and lets you confirm, reject or skip it. From a script, `--confirm ID` and `--reject ID` do the same, and repeat for more ids. These are for a person: run by an agent (standard input not a terminal, no `--by person`) they refuse:

```
drift: --confirm is for a person: an agent's answers wait for one (run it in a terminal, or, for a script a person runs, with --by person and DRIFT_SETUP_PERSON=1)
```

A rejected answer is not asked again until what it rests on changes. When the agent finishes it tells the person how many of its answers wait (`waiting` in `drift setup --json`; `drift setup --list` shows them first).

## What the questions rest on

Each answer is recorded with a fingerprint of the evidence it was given on (the `seen` value): for a compose file, its path and the services it starts; for a Terraform tie, the code directory and the target groups that matched and why; for a check, the function's first lines and why Drift could not count it. In a test, changing a published port of a compose file did not reopen its question, and adding a service did. When that fingerprint changes, the question shows as changed (`status: changed` in `drift setup --json`; `drift setup --list` and interactive `drift setup` list it like an open question, without a mark) and is asked again. **The earlier answer keeps applying until you answer again**: the lines it wrote to `.drift/config.yaml` stay, and `drift security` still reads them. An answer an agent gave and no person confirmed is judged differently: it shows as changed whenever it would now make a fact (see the trust rule), because Drift judges it against the repository each time the config is read, not once when it was written. Anything else the repository changes leaves an answer as it is, and nothing tells you it has gone out of date.

## Beyond the questions: `drift investigate`

Confirming `internal` for an investigate item writes under `security.internal` the narrowest directory that holds the item's routes and no other entry point or package, else the routes' files; never the repository root. The effect says what the line covers, including routes added there later.

The questions above are the few Drift can ask in advance. For every other route it could not settle, `drift investigate` lists the route with the code to read, and an agent or a person records an outcome. It follows the same trust rule: an outcome that would make a fact (`guard:`, `check:` or `internal`) is a proposal that a person confirms in `drift setup --review`, which shows these proposals beside setup's. An outcome that only keeps or raises caution (`not-a-guard`, `not-a-check`, `reachable`, `skip`), a finding and a gap report take effect at once, and findings and gap reports are local files under `.drift/findings/` and `.drift/gap-reports/`, git-ignored and never posted. See [Using Drift with Agents](Using-Drift-with-Agents#investigating-open-routes) and the [Command Reference](Command-Reference#drift-investigate).

> **Changing soon.** What is not built yet: answers in `.drift/config.yaml` that go stale when the evidence they rested on changes, with a report that says which. Today, a person's answer whose evidence changed is asked again (above) but keeps applying until you answer it again, and nothing else in the repository's changes is noticed. Re-run `drift setup` after changing deployment files, and review `.drift/config.yaml` in pull requests like any other policy file.

See also: [Security Inventory](Security-Inventory), [Practices Map](Practices-Map), [Using Drift with Agents](Using-Drift-with-Agents), [Command Reference](Command-Reference), [Team Rollout](Team-Rollout), [Configuration Reference](Configuration-Reference), [MCP Reference](MCP-Reference).
