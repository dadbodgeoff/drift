# Labelling rubric: was each listed mechanism found (variant-recall match step)

This is the second step of the variant-recall arm (PREREG-R13-practices.md §3.4, §6.4; PLAN-R14 WS-F F6). The matcher sees one package, the mechanisms a lister found in it for each primary concern (the lister never saw the tool's output), and the tool's variants in that package, and marks each listed mechanism. Rubric id `practice-recall-match`; lib.mjs `APPROVED_PRACTICE_RUBRICS` pins the labeller-facing text.

## The setting

A tool read a repository and, for each cross-cutting concern, sorted the code units of each package into **variants**: ways of handling the concern, such as "wrapped in `withWorkspace()`", or `none`, a recorded absence. Separately, a person who was not shown the tool's answer listed the mechanisms one package uses for each concern. You are shown both lists, and the code. Say, for each listed mechanism, whether the tool has it.

## The card

- `package`: the package's directory.
- For each concern: `listed`, the lister's mechanisms in order (`mechanism instrument`, with an example file), numbered from 1; and `tool`, the tool's variants in that package (label, whether known or `none`, mechanisms and instruments). A concern where the tool has no variant in the package shows `tool: (none in this package)`.

## What to answer

For each listed mechanism, in order:

- **FOUND:** one of the tool's variants in the package is that mechanism: the same instrument applied the same way (for a listed `none`, the tool's `none` variant). Wording does not matter; check the code when the names differ.
- **PARTIAL:** a tool variant has part of it: one instrument of a combination, or the instrument applied another way.
- **MISSED:** no tool variant in the package corresponds to it.

Open the example file and the instrument's definition when the names differ. List what you opened in `checked`.

## Output

One JSON object per package, one per line (JSONL). The example is made up: the repository `acme-shop` does not exist.

```json
{"uid": "acme-shop/recall/pkg-1a2b3c4d", "rubric": "practice-recall-match",
 "concerns": {"authn": [{"match": "FOUND"}, {"match": "FOUND"}], "authz": [{"match": "MISSED"}],
              "validation": [{"match": "FOUND"}], "errors": [{"match": "PARTIAL"}], "api": [{"match": "FOUND"}]},
 "checked": ["api/admin/users.ts", "api/orders/list.ts"],
 "reason": "The role check in admin/users.ts has no tool variant; the try/catch is the tool's in_body_try without the response builder."}
```

| Field | Required | Values |
| --- | --- | --- |
| `uid` | yes | as given on the card |
| `rubric` | yes | `"practice-recall-match"` |
| `concerns` | yes | the same five keys as the card; each a list with one `{ "match": "FOUND" \| "PARTIAL" \| "MISSED" }` per listed mechanism, in the card's order |
| `checked` | yes | the repo-relative files you opened |
| `reason` | yes | one or two sentences |

Answer each mechanism on its own. There is no expected distribution of answers.
