# Reviewer prompt (labellers A and B)

This is the exact prompt given to each independent labeller. Render it with `prompt.mjs`; do not fill it in by hand:

```sh
node eval/study/prompt.mjs label --run eval/study/runs/NAME --labeller A   # one prompt per repo
node eval/study/collect.mjs --run eval/study/runs/NAME --stage label        # B waits until A's output is collected
node eval/study/prompt.mjs label --run eval/study/runs/NAME --labeller B
```

## Placeholders

`prompt.mjs` fills in:

| Placeholder | Filled with |
| --- | --- |
| `{{REPO}}`, `{{REPO_URL}}`, `{{REPO_SHA}}` | the repository and its pinned commit |
| `{{REPO_DIR}}` | the pinned checkout prepared by `prepare.mjs` |
| `{{RUBRIC}}` | the full text of the run's rubric, from "## The setting" on: `RUBRIC-v3.md` for runs started after decision D6, `RUBRIC-v2.md` for runs that already use it (`prompt.mjs --rubric`) |
| `{{PROPOSALS}}` | this repository's proposals, exactly as `drift census --all-outliers` prints them, without Drift's rank numbers, in an order shuffled per labeller |
| `{{COUNT}}` | the number of proposals |
| `{{OUTPUT_FILE}}` | a fresh outbox, `<cache>/outbox/<random uuid>/out.jsonl`, outside the Drift repository. The path does not say which stage, labeller or repo it is for, and it is recorded only in `prompts/index.json`. |

Besides the outbox, `prompt.mjs` makes each prompt a fresh, empty working directory, `<cache>/workdirs/<random uuid>/` (`cwd` in `prompts/index.json`, printed as "launch in (cwd)"), outside every git work tree, the Drift repository, the run directory, the checkouts and the outbox root (it refuses a root that is not). The prompt does not name it.

The prompt never says which labeller it is for. `collect.mjs` fills in the `labeller` field from `prompts/index.json`.

## Running the labellers (orchestrator)

**Blinding.** A labeller sees only three things: the rubric, the proposals, and the repository. Never include:

- another labeller's labels or reasons;
- earlier studies, or `labels.jsonl`;
- Drift's source code or documentation;
- the expected numbers;
- which labeller this is relative to others ("second opinion", "relabel").

**Isolation.**

- Launch each (labeller, repo) prompt as a fresh agent with no shared context, **with its working directory set to that prompt's `cwd`**: the fresh, empty directory `prompt.mjs` printed for it. Never start a labeller in a Drift checkout or worktree (the orchestrator's included), the run directory, a repo checkout or the outbox. A labeller started in the orchestrator's worktree once wrote a copy of its output there.
- `collect.mjs` rejects an output while that directory is not empty, while the outbox holds any other file, when the checkout changed, or when a copy of the records is in an untracked file of the Drift repository or under the outbox root; a prompt with no output but files in its working directory is MISSING. Move such files aside unread, record the deviation, and relaunch.
- Give the agent read access to `{{REPO_DIR}}` and write access to `{{OUTPUT_FILE}}` only, where the runtime allows it (a sandbox or container that mounts just those).
- Where it does not, the instructions below are the control. Note the weaker isolation in the study report.

**Sequencing.** `prompt.mjs` renders B's prompt for a repo only after A's output for it has been collected, or the reverse. `collect.mjs` moves the output out of the outbox, so one labeller's file never exists while the other is working on the same repo. Different repos can run in parallel.

**Independence.**

- A and B should not be the same agent session.
- If more than one model is available, use different models or model versions for A and B, and record which in the run's README.

The text between the markers below is the prompt.

<!-- BEGIN PROMPT -->
You are labelling proposed coding conventions for the repository **{{REPO}}** ({{REPO_URL}} at commit `{{REPO_SHA}}`).

A checkout of the repository at that commit is at:

    {{REPO_DIR}}

## Rules for this task

1. **Work only from the repository checkout.**
   - Read files, and search with grep, find or ripgrep, inside `{{REPO_DIR}}`.
   - Do not modify anything there.
   - Do not install dependencies, run builds, or access the network.
2. **Do not open anything outside `{{REPO_DIR}}`,** except for writing your output file. In particular, do not look for:
   - the tool that produced these proposals, or its source code or documentation;
   - anyone else's labels or reviews of these proposals;
   - anything on the internet.
3. **Ignore a `.drift/` directory if one exists in the checkout.** It is a cache of the tool, not part of the project.
4. **Label every proposal independently,** following the rubric below exactly.
   - Open the files the rubric requires before deciding: the example, at least three outliers, at least two other members, and the lint or compiler config when TRIVIAL is in question.
   - List every file you opened in `checked`.
5. **Write your labels to `{{OUTPUT_FILE}}`:**
   - one JSON object per line;
   - exactly one line for each of the {{COUNT}} proposals;
   - no other text in the file.
   The directory already exists. If you stop early, the lines you wrote must still be valid.
   - Write nothing else, anywhere: no copies, drafts or notes, not in your working directory (it is an empty scratch directory) and not in the checkout.
6. **When you finish, reply with one line:** the number of proposals labelled, and the count of each label. Do not repeat the reasons.

## Rubric

{{RUBRIC}}

## The proposals ({{COUNT}})

Each proposal starts with its `uid`. Copy it exactly into your output.

{{PROPOSALS}}
<!-- END PROMPT -->
