# Adjudicator prompt (labeller C)

Given to a third labeller for each proposal where A and B disagree. Render it with:

```sh
node eval/study/adjudicate.mjs --run eval/study/runs/NAME              # writes adjudication/queue.json
node eval/study/prompt.mjs adjudicate --run eval/study/runs/NAME       # one prompt per repo with disagreements
```

The adjudicator sees:

- the rubric;
- the proposal;
- the repository;
- both labels with their reasons and files checked.

The two reviewers are shown as "Reviewer 1" and "Reviewer 2", in an order that is shuffled per proposal. The adjudicator is never told which is A or B, or what the rest of the study looks like.

C must not be the same agent session as A or B.

## Placeholders

| Placeholder | Filled with |
| --- | --- |
| `{{REPO}}`, `{{REPO_URL}}`, `{{REPO_SHA}}`, `{{REPO_DIR}}` | as for reviewers |
| `{{RUBRIC}}` | the full text of the run's rubric, the same one A and B saw: `RUBRIC-v3.md` after decision D6 |
| `{{CASES}}` | for each disagreement: the proposal, then both reviews |
| `{{COUNT}}` | the number of cases |
| `{{OUTPUT_FILE}}` | C's outbox, a fresh `<cache>/outbox/<random uuid>/out.jsonl` |

<!-- BEGIN PROMPT -->
You are adjudicating labels of proposed coding conventions for the repository **{{REPO}}** ({{REPO_URL}} at commit `{{REPO_SHA}}`).

Two reviewers labelled each proposal below independently, following the rubric, and they disagreed. Your label is final. A checkout of the repository at that commit is at:

    {{REPO_DIR}}

## Rules for this task

1. **Work only from the repository checkout.**
   - Read and search inside `{{REPO_DIR}}`.
   - Do not modify it, install dependencies, run builds, or access the network.
   - Do not open anything outside it, except for writing your output file.
   - Ignore any `.drift/` directory.
   - Write nothing but your output file, anywhere: no copies, drafts or notes, not in your working directory (it is an empty scratch directory) and not in the checkout.
2. **Do not decide by majority or by deference.**
   - Re-open the files yourself: the example, the outliers, other members, and configs.
   - Then apply the rubric's questions in order.
   - The reviewers' reasons tell you where to look, not what to conclude.
   - When a reviewer claims a lint rule, a framework requirement or a type error makes the rule TRIVIAL, verify it in the config or code. An unverified claim does not count.
3. **Your label may be any of the three,** including one neither reviewer chose.
4. **Write one JSON object per case to `{{OUTPUT_FILE}}`,** using the rubric's output format, with these differences:
   - an extra field `"sided_with"`: `"1"` or `"2"` if your label is that reviewer's label, `"neither"` if it is a third label;
   - `"reason"` explains what settled it, citing files.
5. **When you finish, reply with one line:** the number of cases and the count of each label.

## Rubric

{{RUBRIC}}

## Cases ({{COUNT}})

{{CASES}}
<!-- END PROMPT -->
