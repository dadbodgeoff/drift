# sem11: the semantic check on the build set, offline (WS-G, 2026-11-08)

**Build-set data, in-sample for every design fold. Not a held-out run; no verdict.** Pre-registration:
[`../../research/2026-11-08/sem11-prereg.md`](../../research/2026-11-08/sem11-prereg.md) (committed before any sample).
Findings: [`../../research/2026-11-08/sem11-findings.md`](../../research/2026-11-08/sem11-findings.md).

## Files
| File | What |
|---|---|
| `cards.jsonl` | Per card: uid, the payload's content hash, prompt sha256, the message's sha256 and length, the judged members (path, symbol, line, flagged, protected), the legacy outlier count, the outlier symbols the card lists, and the model calls made. The messages quote repository code and stay in scratch. |
| `samples.jsonl` | Per sample: the reply as the model gave it, whether it parsed, attempts, tokens, cost and wall time. |
| `outcomes.jsonl` | The product's decision per card: the replies sent back through `drift_semantic_card` (MCP), which parses them, decides per member (2 of 3), applies the structural `protected` invariant and caches the verdict. |
| `score.json`, `score.md` | `sem11-score.mjs` output. |
| `scripts/` | The harness as run (scratch paths as on the run machine; it needs the product at `99631796`). |
| `harness-e2e-T02/` | The study harness (no product code) end to end on one dev3 card. |

## How it ran
1. **Binary.** `build-verified.sh` CGU 78 at `8ef8646a` (tag `cgu78-8ef8646a-1794175626`, sha256 `f60857e5…`). Later
   commits on the branch change tests, docs and the study only; `semantic.rs` changed only by `cargo fmt`.
2. **Payloads** (`scripts/payloads.sh`, one repo at a time). A hard-linked copy of the dev clone (only new files are
   written: `.drift/`, `drift.lock`; each source clone checked clean after). `.drift/config.yaml` turns Python
   proposals on. `scripts/mkpolicy.py` writes the labelled run's own `proposals/<repo>.yaml`, kept to its labelled ids,
   each `accepted` (so the show policy keeps the hidden suggestions, as it keeps what a person accepted), with
   `agents.semantic: on`. `drift init --max 15 --all` merges and baselines the lock. Then `drift mcp`,
   `drift_semantic_card` with only `id`, per card. 237 of the 238 labelled cards (documenso `D-a10f62` is not in its
   run's conventions file, as relabel5 found).
3. **Samples** (`scripts/srun.py`): 3 per card, each a fresh headless CLI process with no tools, no MCP, no settings and
   no persistence, in an empty directory, on the verifier's small model (the same alias relabel5's verifier run gave on
   the command line); system prompt = the payload's (sha256 checked), user turn = the payload's message. One retry when
   a reply would not parse. The CLI has no temperature option: the samples ran at its default.
4. **Decision** (`scripts/decide.sh`): the same checkout rebuilt, and each card's 3 replies sent back through
   `drift_semantic_card` with the content hash and the model identifier the CLI reported. The product refuses a changed
   card or another model, decides and caches; its reply is the outcome.
5. **Export and score**: `scripts/export.py`, then `node eval/study/research/2026-11-08/sem11-score.mjs --run
   eval/study/runs/sem11-2026-11-08 --json …/score.json --md …/score.md`.

## The product code is reverted
The run used the product's payload and decision at `99631796` (now reverted on `ws/sem11`, lead decision on #139);
`scripts/` call `drift_semantic_card`, so they rerun only on a binary built from that commit. The harness that needs
no product code is `eval/study/semantic/harness.mjs`; `harness-e2e-T02/` is its end-to-end run on one dev3 card.

## For dev4 (the operator pre-registers the "semantic-on" arm)
On the frozen F11 binary, per dev4 census checkout: `drift scan --no-cache --out <facts.json>` (it writes nothing in
the checkout), then
`node eval/study/semantic/harness.mjs --census <its census --json> --root <checkout> --facts <facts.json> --repo <key> --model <the verifier's small-model alias> --out <dir>`,
and score the outcomes against the blind A/B per-outlier verdicts with `sem11-score.mjs`'s pure functions
(`matchVerdicts`, `cardFlagEffect`, `admitFlags`, `kappa`). Prompt `sem-v1`, sha256
`95ec1162366afdd669cf56739418f7cd34c0bb2130093c938e40ee0c62991752`; the model is fixed by `MODEL_SHA256` in the harness.
See `../../research/2026-11-08/sem11-findings.md` for the harness-v1 payload differences, the determinism precondition
and the file-unit matching gap.
