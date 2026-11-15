# Recall match prompt (matcher R1)

The second step of the variant-recall arm (PREREG-R13-practices.md §3.4, §6.4; `RUBRIC-practice-recall-match-v1.md`). Matcher R1 sees the lister's collected list for each package next to the tool's variants in that package (lib.mjs `labellerCard(item, { list })`), and marks each listed mechanism FOUND, PARTIAL or MISSED. See `RECALL-LIST-PROMPT.md` for the sequence.

The text between the markers below is the prompt.

<!-- BEGIN PROMPT -->
You are checking lists of the mechanisms some packages use against a tool's classification of the same code, in the repository **{{REPO}}** (its name, address and commit are withheld).

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
