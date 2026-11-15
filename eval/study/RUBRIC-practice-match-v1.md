# Labelling rubric: does the description match the assignment (match step)

This is the second of the two labelling steps of the practice-map accuracy measure (PREREG-R13-practices.md, PLAN-R14 WS-F F6). The matcher sees one labeller's description of a unit (written without the tool's assignment), the tool's assignment, and attributes to check, and answers two things: is the described mechanism the assigned one, and does the unit have each attribute. Rubric id `practice-match`; lib.mjs `APPROVED_PRACTICE_RUBRICS` pins the labeller-facing text.

<!-- study-only -->
The label is derived in code (lib.mjs derivePracticeLabel) from the assignment, the description's outcome and `same`; the matcher does not label CORRECT or WRONG itself. Some attributes are controls (attributes of another variant put on this unit); the card does not say which.
<!-- /study-only -->

## The setting

A tool read a repository and, for a cross-cutting concern (authentication, error handling, logging, ...), put each unit of code into one **variant**: a way of handling the concern, such as "wrapped in `withWorkspace()`", or `none`, a recorded absence, or `unknown`. Separately, a person who was not shown the tool's answer read the unit and **described** what it does for the concern. You are shown both, and the unit's code.

## The card

- `concern` and `unit`: the concern and where the unit is (file, line, symbol).
- `described`: the description's outcome (`DOES`, `NONE`, `CANNOT_TELL`, `NOT_IN_POPULATION` or `UNSURE`) and its mechanisms, each `mechanism instrument`; then the description in words.
- `assigned`: the tool's variant: its label, and whether it is a known variant, `none` or `unknown`; its mechanisms and instruments (`wrap: apps/web/lib/auth.ts#withWorkspace` means wrapped by `withWorkspace`, defined in `apps/web/lib/auth.ts`).
- `attributes to check against this unit`: facts about where the unit sits or what it uses, each `kind:value`: `package:`, `dir:` (a directory it is under), `stem:` (its file name without extension), `lang:`, `role:` (a group the tool formed; judge it from path and kind, or UNSURE), `entry:` (its entry kind), `method:`, `route:` (the first route segment), `imports:` (a module its file imports), `wrap:` (an instrument from another concern it uses).

## What to answer

**`same`** (only when the description says `DOES` and the assignment is a known variant; otherwise `null`):

- **true** when the described mechanisms and instruments are the assigned ones: the same instrument applied the same way, and no further instrument that the assignment leaves out. Wording does not matter: "wrapped by withShopUser" and `wrap: lib/auth.ts#withShopUser` are the same. Check the code when the two name the instrument differently.
- **false** when they differ: another instrument or mechanism, an extra instrument that also does the concern, or one of them missing.

Copy the description's outcome into `described_does`.

**`apart`:** for each attribute, a verdict on **this unit only**: `TRUE` (the unit has it), `FALSE` or `UNSURE`. Do not judge whether the attribute explains anything or fits either answer.

Open the unit's file, and the instrument's definition when the names differ. List what you opened in `checked`, the unit's file first.

## Output

One JSON object per unit, one per line (JSONL). The example is made up: the repository `acme-shop` does not exist.

```json
{"uid": "acme-shop/authn/3f9a01c2", "rubric": "practice-match", "described_does": "DOES", "same": true,
 "apart": [{"attribute": "dir:api/orders", "verdict": "TRUE"}],
 "checked": ["api/orders/list.ts", "lib/auth.ts"],
 "reason": "The description's withShopUser is the assigned wrap instrument lib/auth.ts#withShopUser; no other auth mechanism is described."}
```

| Field | Required | Values |
| --- | --- | --- |
| `uid` | yes | as given on the card |
| `rubric` | yes | `"practice-match"` |
| `described_does` | yes | the description's outcome, copied from the card |
| `same` | yes | `true` or `false` when the description says DOES and the assignment is a known variant; `null` otherwise |
| `apart` | yes | one entry per attribute shown, `{"attribute": "<exactly as shown>", "verdict": "TRUE" \| "FALSE" \| "UNSURE"}`; `[]` when none |
| `checked` | yes | the repo-relative files you opened, the unit's file first |
| `reason` | yes | one or two sentences |

Answer each unit on its own. There is no expected distribution of answers.
