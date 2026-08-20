# CHARTER 04 — Help and documentation consistency

**Depends on:** 03 · **Est. 2 h** · **Output:** `results/04-help-and-docs-consistency.md`

---

## 0. Harness contract

```bash
source ~/drift-beta-freeze/env.sh && assert-env
```

Every command in this charter goes through `run-probe`, with its oracle declared as assertions so
the verdict is **computed, not argued**:

```bash
run-probe 04 <probe-id> --expect-exit 0 --expect-json-valid -- <command>
```

Benchmarks go through `bench` (which reports median, p95, MAD, CV, outliers, and tests for thermal
drift), never a hand-rolled timing loop. Mutating probes get their own workspace:
`eval "$(workspace.sh 04 <probe-id> --golden corpus-taxonomy)"`. Full output lands on disk; the
ledger is the source of truth, and `validate-result 04` rejects any results file whose claims
contradict it. See [HARNESS.md](HARNESS.md).

## 1. Objective

Execute the documentation. Every command in `--help`, in `docs/quickstart.md`, in `README.md`, in
`docs/ci-integration.md`, and in `docs/agent-integration.md` gets run exactly as written, from the
environment the document implies. What does not work as written is the finding.

This is a different question from charter 03. Charter 03 asks *what the surface does*. This asks
*whether the surface matches what the product claims about itself*.

## 2. Scope

**In.** `drift --help` (top-level and all per-command sections, `args/help.ts:146-466`); every
fenced command block in `docs/`; `README.md`; the claims validated by
`scripts/validate-product-claims.mjs`; `SUPPORTED_LANGUAGES_FRAMEWORKS.md`-equivalent claims about
framework support.

**Out.** Prose accuracy about architecture — that is what the forensics report already covers.
This charter is about **executable claims**.

## 3. Procedure

| Probe | What to do |
|---|---|
| P-04-01 | Extract every fenced shell block from `docs/**/*.md` and `README.md` mechanically. Record the count. Do not hand-pick. |
| P-04-02 | Run each block in a clean environment matching the document's stated preconditions. Record exit code and whether the output resembles what the doc shows. |
| P-04-03 | `drift --help` with no positional argument (falls through to the default block at `help.ts:388-466`). Extract every example command from the "Core commands" block and run each verbatim. |
| P-04-04 | For each per-command help section (`contract`, `findings`, `audit`, `backup`, `policy`, `check`, `conventions`, `baseline`, `security`, `checks`, `repo`), extract and run every example. |
| P-04-05 | Cross-check the top-level Usage synopsis `drift --db <path> <command> [options]` (`help.ts:392`) against the Core-commands example block (`help.ts:399-442`), which omits `--db` entirely. Record whether both can be simultaneously correct for the same command. |
| P-04-06 | For every flag documented in help, invoke it and confirm it is accepted. For every flag accepted by the parser (derive from source), confirm it is documented. Report both directions. |
| P-04-07 | Run `pnpm validate:claims` (`scripts/validate-product-claims.mjs`) and record what it checks and what it does not. A claims-validator that does not cover the claim in P-04-05 is itself a finding. |
| P-04-08 | Test the documented framework support claim: which frameworks does the documentation say are supported, and what does charter 08 / shape C show is actually recognized? Reconcile. |
| P-04-09 | `docs/ci-integration.md` — set up the documented CI integration in a scratch repo and run it. Does the documented gate actually gate? (Charter 22 goes deeper; this probe only tests the doc as written.) |
| P-04-10 | `docs/agent-integration.md` — drive the documented agent flow. (Charter 19 goes deeper on MCP itself.) |

## 4. Benchmarks

Not a timing charter. The counted metrics are:

- fenced command blocks found / run / succeeded as documented
- help examples found / run / succeeded
- flags documented but not accepted; flags accepted but not documented
- documented outputs that differ materially from observed outputs

## 5. Oracles

Every executable claim in the documentation executes, from the environment the document implies,
and produces output consistent with what the document shows.

## 6. Suspect list — confirm or refute

| ID | Claim | Source | How to test |
|---|---|---|---|
| S-04-1 | The top-level help's Usage synopsis places `--db <path>` before `<command>` (reading as mandatory) while the same help's own Core-commands examples omit `--db` for commands that require it — an internal self-contradiction in one file. | §18b, `help.ts:392` vs `:399-442` | P-04-03, P-04-05 |
| S-04-2 | Per-command help sections prepend `drift --db <path> …` consistently, so the contradiction is confined to the block a first-time reader sees by default. | §18b | P-04-04 vs P-04-03 |
| S-04-3 | `drift ask` and `drift prepare` help text claims no source snippets are included; the payloads declare `snippets_included: false, source_content_included: false`. | §20g, `help.ts:111,126`, `ask.ts:116-117` | Run both, inspect the JSON payload for any source content. Charter 21 owns the full privacy sweep; this probe only checks the *claim*. |
| S-04-4 | Documentation describes `prepare` as having a whole-graph cost profile that the measured behavior does not reproduce. | §3.2, §19c | Compare doc language to charter 16's measurements. |
| S-04-5 | `validate-product-claims.mjs` is part of `verify:ci` and therefore gates — determine what claim set it actually covers. | `package.json`, §3.6 | P-04-07 |

## 7. Failure protocol

A documented command that fails is recorded with the doc file and line, the command verbatim, the
observed failure, and the cause. Continue.

## 8. Deliverables

`results/04-help-and-docs-consistency.md` with a table of every extracted command block →
document location → result; transcripts under `results/artifacts/04/`.
