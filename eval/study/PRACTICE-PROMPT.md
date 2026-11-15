# Practice describe prompt (labellers A, B and C)

The first of the two labelling steps of a practice run (PLAN-R14 WS-F F6; `RUBRIC-practice-describe-v1.md`; `PREREG-R13-practices.md`). The labeller sees the unit and the concern, and **never** Drift's assignment, its attributes, shares or counts. Render it with `prompt.mjs`; do not fill it in by hand:

```sh
node eval/study/practices.mjs sample --runs RUNDIR --out eval/study/runs/NAME --cache DIR
node eval/study/prompt.mjs label --run eval/study/runs/NAME --labeller A --model ID   # describe; one prompt per repo
node eval/study/collect.mjs --run eval/study/runs/NAME --stage label
node eval/study/prompt.mjs match --run eval/study/runs/NAME --labeller MA --model ID  # match A's descriptions
node eval/study/collect.mjs --run eval/study/runs/NAME --stage match
#   ... the same for B (on another model) and MB; then C (a third model) on the units whose labels differ, and MC
node eval/study/practices.mjs score --run eval/study/runs/NAME
```

`prompt.mjs` masks the repository (an opaque key, no URL or commit, the checkout through an opaquely named link), records `--model` (F4: A, B and C run on three different models), and refuses a prompt that fails lib.mjs `promptLeaks`.

## Placeholders

| Placeholder | Filled with |
| --- | --- |
| `{{REPO}}` | an opaque key for the repository |
| `{{REPO_DIR}}` | a link to the pinned checkout, under an opaque name |
| `{{RUBRIC}}` | lib.mjs `rubricText("practice-describe")` |
| `{{UNITS}}` | this repository's sampled units, each rendered by lib.mjs `labellerCard` (the describe card: concern and unit only), in an order shuffled per labeller |
| `{{COUNT}}` | the number of units |
| `{{OUTPUT_FILE}}` | a fresh outbox, as for `REVIEWER-PROMPT.md` |

Blinding, isolation, sequencing and independence are as in `REVIEWER-PROMPT.md`.

The text between the markers below is the prompt.

<!-- BEGIN PROMPT -->
You are reading code in a repository, **{{REPO}}** (its name, address and commit are withheld), to say what each of a list of units does for a given concern.

A checkout of the repository is at:

    {{REPO_DIR}}

## Rules for this task

1. **Work only from the repository checkout.**
   - Read files, and search with grep, find or ripgrep, inside `{{REPO_DIR}}`.
   - Do not modify anything there.
   - Do not install dependencies, run builds, or access the network.
2. **Do not open anything outside `{{REPO_DIR}}`,** except for writing your output file. In particular, do not look for:
   - the tool these units come from, or its source code or documentation;
   - anyone else's labels of these units;
   - anything on the internet.
3. **Ignore a `.drift/` directory if one exists in the checkout.** It is a cache of the tool, not part of the project.
4. **Label every unit independently,** following the rubric below exactly. List every file you opened in `checked`, the unit's file first.
5. **Write your answers to `{{OUTPUT_FILE}}`:**
   - one JSON object per line;
   - exactly one line for each of the {{COUNT}} units;
   - no other text in the file.
   The directory already exists. If you stop early, the lines you wrote must still be valid.
   - Write nothing else, anywhere: no copies, drafts or notes, not in your working directory (it is an empty scratch directory) and not in the checkout.
6. **When you finish, reply with one line:** the number of units answered. Do not repeat the reasons.

## Rubric

{{RUBRIC}}

## The units ({{COUNT}})

Each unit starts with its `uid`. Copy it exactly into your output.

{{UNITS}}
<!-- END PROMPT -->
