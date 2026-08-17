# `packet_within_envelope_budget` — why `eval:external` is red at `255f2208`

Investigated in an isolated read-only worktree at `255f2208`. Nothing was edited, committed,
or blessed. This is a **pre-existing defect unrelated to the ground-truth remediation**; it is
recorded here because §6 and §9.4.6 assume the eval suites are green at baseline and they are
not.

## Mechanism

`prepare --json` embeds the whole `scan status` payload, and that payload carries every
itemized parser-gap record:

- `packages/cli/src/domain/scan-status.ts:951` — `parserGapSummary` returns `records: gaps`
- `packages/cli/src/domain/scan-status.ts:810` — `scanStatusPayload` includes that section
- `packages/cli/src/commands/prepare.ts:268` — `prepare` embeds the payload wholesale

The assertion (`scripts/external-eval.mjs:452`) measures raw stdout, so every record counts.

Measured on openstatus at `255f2208`:

```
TOTAL stdout bytes: 714662   budget 500000
  367855  scan_status
   89818  graph_context
   23500  task_preflight_packet
   21897  semantic_coverage
    4522  guidance
  -- scan_status.parser_gaps --
  359973  records   n=702      <-- 50.4% of the entire envelope
      85  by_kind
  same payload with records emptied: 188607 bytes
```

**The same envelope already carries the bounded form four lines away.** `prepare.ts:202-206`
is explicitly labelled BB-6 — "the summary, not the records" — after BB-6 measured those
records at 358,538 bytes on dub and removed them from `task_preflight_packet`. The records
BB-6 took out of that field re-entered the same document one level up.

## Introducing commit

**`f3f81257`** ("W4 part 1 — guidance budget, route classification, gap pointer", item D-A5,
2026-08-15). Its diff of `scan-status.ts` is precisely the two hunks adding `records` to the
return type and the body. No such field existed before.

The uniform **+5 `guidance_bytes`** shares that cause: the same commit changed the pointer
string from `drift doctor --repo …` to `drift scan status --repo …` — exactly +5 characters,
occurring once in `guidance`.

**`openstatus.baselined` 30 → 31 is independent and unexplained.** Extraction is unchanged
(`files=2185, facts=90385`, byte-identical to the `d2517b96` baseline row), so the extra
violation comes from the evaluation/baseline-seeding layer on identical facts. The likeliest
candidate is `2ac6ebcc` (which unified onboarding baseline seeding and whose own commit body
records `openstatus … 31 = 31` while the eval baseline still said 30), **but this was not
confirmed by bisect and is not asserted as fact.** It is a real detection change and should be
explained before anyone pins it.

## Verdict: real product defect, not merely a stale baseline

- D-A5's intent was to make `full_list_command` point at a surface that actually serves the
  data. Moving records onto `scan status` was correct; embedding them in `prepare` was
  collateral, and no commit argues `prepare` should carry them.
- The opposite decision is written into the same file by BB-6, with its measurement.
- 714 KB is roughly 180k tokens for one onboarding packet, ~90k of it a flat record list
  reachable in full via one named command.
- The baseline being stale (last blessed `d2517b96`, before W1–W4) is a *second* bug — it is
  why this went a sprint undetected — not a justification for the size.

## Disposition for this remediation: report, do not absorb

**A fix already exists in flight**, on `remediation/w7-detection` (`bfe1e14e`, finalized in
`ee0b1f33`): `prepare` and MCP `get_task_preflight` share a `withParserGapRecordsOmitted`
helper that empties `records` and names what was withheld (`records_omitted`,
`records_command`), plus a test that follows the pointer it advertises and checks the count
matches.

**This remediation does not cherry-pick it, and does not bless the baseline.** Reasons:

1. It is outside this remediation's scope (D1–D5), and pulling another branch's unmerged
   commits into the integration branch to make a gate go green is gaming the gate — the same
   act as blessing a baseline, which §9.4.4 forbids.
2. It duplicates commits that will land through their own PR, creating conflicts.
3. `updateGate` (`external-eval-predicate.mjs:176-197`) already refuses `--update` while any
   verdict is FAIL. That protection is correct and must not be worked around.

The merge gate is therefore evaluated against **this remediation's own deltas**, with the
pre-existing failure named explicitly rather than absorbed. See the final report.

## Operational protocol for T3 runs (verified, not assumed)

`eval:external` **remains fully usable** for detecting fact-layer regressions while this is red:

- The failure is isolated and named: openstatus's `failed_assertions` is exactly
  `["packet_within_envelope_budget"]`. Every other assertion in `repoVerdict`
  (`external-eval-predicate.mjs:14-105`) still runs and passes — injection caught, evidence
  correct, no clean-control FP, no type-only FP, no lookalike FP, subpath caught, enforcement
  matches mode, exemplar integrity, engine source rust, no fallback. Nothing short-circuits.
- The baseline diff is unaffected: `diffResult` walks every non-`VOLATILE` key independently,
  so `baselined`, `findings_count`, `blocking_count`, `exemplars_*`, `forbidden_imports`,
  `check_exit_code`, `check_status` all still diff and print.
- **Only the exit code is lost** (`external-eval.mjs:681` exits 1 on either a changed diff or
  a failing verdict). **Read the printed output, not `$?`.**

**Regression criterion used at every T3 boundary in this run:** a new line under
`changed vs baseline`, or a new name in `failed_assertions` beyond
`packet_within_envelope_budget`. The run recorded in `BASELINE-EVALS.md` is the reference.

## One forward-looking note for the repo owner

The W7 parser work (`e16a63c9`) introduces `partial_parse` gaps that previously could not
exist — reported as 129 files across the seven corpus repos. Each new gap is another ~513-byte
record, so that work *widens* this failure until `bfe1e14e`/`ee0b1f33` land with it. Strictly
additive, not a conflict.

Separately, and beyond this remediation's scope: `scanStatusPayload` is opt-out by default, so
every embedder inherits the records and each must remember to strip them. Eight sites still
embed the unstripped payload (`policy.ts:74`, `findings.ts:57`, `findings.ts:100`,
`ask.ts:117`, `repo-map.ts:208`, `mcp/index.ts:540`, `:655`, `:1741`) — all agent-facing JSON.
Inverting the default so `drift scan status` opts *in* would make a new embedder safe by
construction. The same defect has now been introduced twice through different doors.
