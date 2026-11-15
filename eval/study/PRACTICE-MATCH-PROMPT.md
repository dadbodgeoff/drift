# Practice match prompt (matchers MA, MB and MC)

The second of the two labelling steps of a practice run (PLAN-R14 WS-F F6; `RUBRIC-practice-match-v1.md`). Matcher MA sees labeller A's collected descriptions (MB: B's, MC: C's) next to Drift's assignment and the attributes to check, and answers whether the described mechanism is the assigned one. Render it with `prompt.mjs match --labeller MA|MB|MC --model ID` once that labeller's descriptions are collected; see `PRACTICE-PROMPT.md` for the whole sequence.

## Placeholders

As in `PRACTICE-PROMPT.md`, with `{{RUBRIC}}` = lib.mjs `rubricText("practice-match")` and `{{UNITS}}` rendered by lib.mjs `labellerCard(item, { match: description })` (the match card: the unit, the description, the assignment and the attributes to check; never a share, a count, a variant id, which variant is dominant, or which attributes are controls).

The text between the markers below is the prompt.

<!-- BEGIN PROMPT -->
You are checking descriptions of code against a tool's classification of the same code, in the repository **{{REPO}}** (its name, address and commit are withheld).

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
