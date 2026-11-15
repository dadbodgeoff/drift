# Recall list prompt (lister L1)

The first step of the variant-recall arm of a practice run (PREREG-R13-practices.md §3.4, §6.4; `RUBRIC-practice-recall-list-v1.md`). The lister sees one package and the five primary concerns, and **never** any output of the tool. Render it with `prompt.mjs`; do not fill it in by hand:

```sh
node eval/study/prompt.mjs recall-list --run eval/study/runs/NAME --labeller L1 --model ID    # one prompt per repo (its 2 packages)
node eval/study/collect.mjs --run eval/study/runs/NAME --stage recall-list
node eval/study/prompt.mjs recall-match --run eval/study/runs/NAME --labeller R1 --model ID   # after L1's lists are collected
node eval/study/collect.mjs --run eval/study/runs/NAME --stage recall-match
node eval/study/practices.mjs score --run eval/study/runs/NAME                                 # adds variant recall
```

The packages are `recall.json`'s (practices.mjs sample). The cards are rendered by lib.mjs `labellerCard`: the list card shows the package and the concerns only. Masking, the leak check, `--model` and the isolation rules are as for `PRACTICE-PROMPT.md`.

The text between the markers below is the prompt.

<!-- BEGIN PROMPT -->
You are reading code in a repository, **{{REPO}}** (its name, address and commit are withheld), to list how some of its packages handle a few cross-cutting concerns.

A checkout of the repository is at:

    {{REPO_DIR}}

## Rules for this task

1. **Work only from the repository checkout.**
   - Read files, and search with grep, find or ripgrep, inside `{{REPO_DIR}}`.
   - Do not modify anything there.
   - Do not install dependencies, run builds, or access the network.
2. **Do not open anything outside `{{REPO_DIR}}`,** except for writing your output file. In particular, do not look for:
   - the tool these packages are compared with, or its source code or documentation;
   - anyone else's lists or labels of these packages;
   - anything on the internet.
3. **Ignore a `.drift/` directory if one exists in the checkout.** It is a cache of the tool, not part of the project.
4. **Answer every package independently,** following the rubric below exactly. List every file you opened in `checked`.
5. **Write your answers to `{{OUTPUT_FILE}}`:**
   - one JSON object per line;
   - exactly one line for each of the {{COUNT}} packages;
   - no other text in the file.
   The directory already exists. If you stop early, the lines you wrote must still be valid.
   - Write nothing else, anywhere: no copies, drafts or notes, not in your working directory (it is an empty scratch directory) and not in the checkout.
6. **When you finish, reply with one line:** the number of packages answered. Do not repeat the reasons.

## Rubric

{{RUBRIC}}

## The packages ({{COUNT}})

Each package starts with its `uid`. Copy it exactly into your output.

{{UNITS}}
<!-- END PROMPT -->
