# Held-out run: runbook

The exact commands of the **primary** held-out run, in order: `eval/holdout-primary.json` (`ts-primary-2026-11-05`, 18 TypeScript/JavaScript repos) and `eval/holdout-primary-py.json` (`py-primary-2026-11-05`, 10 Python repos). The rules are in [README.md](README.md#held-out-rules), and so are the decisions D1–D7a taken before any held-out census ([decision log](README.md#decisions-before-any-held-out-census-2026-11-05)); this file only sequences them. Where the two disagree, the README wins.

**Who may see what (rule 3).** The operator who runs these commands may read counts, statuses, hashes and the final `metrics.md`, `agreement.md` and `recall.md`. Nobody working on the product opens a held-out checkout, `proposals/`, `pool/`, `queue.json`, `prompts/`, `labels/`, `adjudication/`, `final.jsonl` or `recall/` until the run is reported. Every command below prints counts only.

Run every command from the root of the Drift checkout (`metrics.mjs` resolves the manifest path recorded in `run.json` from there). [`HELDOUT-CHECKLIST.md`](HELDOUT-CHECKLIST.md) is the short form of steps 2 and 5–8, with the check each command makes.

**Agents' working directories.** Every agent (A, B, C, E, M) starts in the fresh, empty directory `prompt.mjs` printed for its prompt (`launch in (cwd) ...`; `cwd` in `prompts/index.json`), never in this checkout, a run directory, a repo checkout or an outbox. `collect.mjs` rejects an output while that directory is not empty.

## Freeze checklist

Fill this in, in the run READMEs (step 9), before step 3. Every row must hold before the first held-out command; if one does not, stop and do not freeze.

| Item | What it must be | How it is checked |
| --- | --- | --- |
| **Product commit `F`** | The main commit the run measures: HEAD of a full clone of `main`, less trailing commits that touch only `eval/study/runs/` (`prepare.mjs` computes it). It includes every product and harness PR meant for the run, and nothing merges into the product after it. On 2026-11-07, main is `feefad6`; `F` is the main commit once the last harness PR before the run (at least the one that added this checklist) is merged. | `git rev-parse HEAD`, `git status --porcelain --untracked-files=all` empty (step 0); `run.json` `drift.commit` = `F` (step 3) |
| **Binary sha256** | One binary for both runs and the A/B: `prepare.mjs` builds it from `git archive` of `F` in a fresh target directory (step 3). The release binary of `feefad6` (`cargo build --release --locked --bin drift`) has sha256 `24ed92b6a8e77b04366a83cb1d8e0aa24af4d19749c61976253dac9c91a89542`, the same as `fcec231`'s: no product file changed between them. If `F` changes only `eval/` and `docs/` after `feefad6`, expect the same hash; if it differs, record both and find out why before step 4. | step 3: both `binary_sha256` equal, each equal to `sha256sum` of its copy |
| **Tier file** | `eval/study/tier-d7.json` (decision D7; sha256 of the file `e695112de57a4927952dad89f50eed6bdc87b61e91560e3bb709706c7f30a51a` on 2026-11-07). Both primary manifests and both secondary manifests (D7a) hold its `tier` verbatim, and the product's `tier_of` implements it. | step 0 checks 1 and 4; `prepare.mjs` refuses any other tier and stops on any census `tier:` line that disagrees |
| **Rubric** | `RUBRIC-v3.md`, labeller-facing text sha256 `79316bdc08a60209a5fb4cb887ad35a4ca4131255e96da2909c2242ac4e2c1dd` (decision D6) | step 1's rubric line; `prepare.mjs`, `prompt.mjs` and `metrics.mjs` refuse any other text on a held-out run |
| **Decision log** | D1–D7a, all recorded before any held-out census, in the README's decision log and `lib.mjs` `DECISIONS` (copied into every `metrics.json`). No new decision, override or amendment after the start records are committed (step 5). | `select-holdout.mjs verify` (amendments ordered before any held-out run record); `metrics.json` `decisions` |
| **Labeller setup** | One fresh agent per (labeller, repo) prompt, seeing only its prompt, the checkout and its outbox (README "Launching"). A: the session's default model. B: a different, smaller model, for independence; never concurrently with A on one repo (`prompt.mjs` enforces it). C: a fresh agent that was not an A or B session. E1 and M1 for every repo; E2 and M2 for at least 3 repos per run. This is the setup of the v3 dev rounds (`runs/dev-v3-2026-11-06`, `runs/dev-v3-relabel-2026-11-06`). Record it in the run READMEs by role, as those rounds did; no model identifier goes into a file, commit or PR (repository rule), so the lead keeps the identifiers outside the repository. | the run README; `prompts/index.json` (one entry per prompt) |
| **Costs** | Proposals: at most 15 per repo (`max`), so at most 270 TypeScript/JavaScript and 150 Python; the dev sets showed about 10 per repo. Agent sessions: 56 label prompts (A and B, 28 repos), one C prompt per repo with a disagreement (the v3 dev round adjudicated 10 of 125 TypeScript proposals), 28 extract plus at least 6 E2, 28 match plus at least 6 M2: about 130–150 fresh sessions. Disk: the held-out clones (several GB; the largest repos are a few GB each), about 400 MB per release build (deleted after the copy), one ~17 MB binary kept until both reports are out. No token or wall-clock cost was recorded in the dev rounds: record both per stage in the run README. | the run README |
| **Order of operations** | Steps 0 → 10 below, in order, with no step skipped: freeze checks (0), gates on `F` (1), the dry run on dev repos (2), the binary (3), the technical check and any rule-1 swap (4), the committed and pushed start records, then the census (5), extraction (5, optional, blind to proposals), A then B (6), agreement **before** adjudication (6; `adjudicate.mjs` refuses otherwise), C and the merge (7), matching and recall (7), metrics (8), the report (9), the A/B on the same binary (10). A swap in step 4 returns to step 3 with a new `F`; nothing after step 5 is ever rerun on a new `F`. | each step's checks below |

## 0. Freeze

Call the main commit of the checklist `F`.

**The tier (decisions D5 and D7, approved by the founder 2026-11-06).** The two primary manifests hold `tier-d7.json`'s `tier` (decision D7; before that D5's, applied in #28). The secondary sets hold it too (decision D7a, the lead; before that D5's, D5a). `holdout-manifests.json` holds the current core sha256, and its `amendments` record each change. Before `F` is taken, check all of it. Every command must print OK or pass. If one does not, stop: do not freeze.

```sh
# 1. Every held-out manifest holds tier-d7.json's tier block verbatim:
node --input-type=module -e '
import { readFileSync } from "node:fs";
const tier = (f) => JSON.stringify(JSON.parse(readFileSync("eval/study/" + f, "utf8")).tier);
for (const [p, f] of [["eval/holdout-primary.json", "tier-d7.json"], ["eval/holdout-primary-py.json", "tier-d7.json"], ["eval/holdout.json", "tier-d7.json"], ["eval/holdout-py.json", "tier-d7.json"], ["eval/holdout-2-2026-11-07.json", "tier-d7.json"], ["eval/holdout-2-2026-11-07-py.json", "tier-d7.json"]])
  if (JSON.stringify(JSON.parse(readFileSync(p, "utf8")).tier) !== tier(f)) { console.error(p + ": tier is not " + f + "'"'"'s"); process.exit(1); }
console.log("tier OK");'
# 2. Recompute each core sha256 and compare it with the registry:
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { coreSha } from "./eval/study/lib.mjs";
const reg = JSON.parse(readFileSync("eval/study/holdout-manifests.json", "utf8"));
for (const [p, sha] of Object.entries(reg.manifests))
  if (coreSha(JSON.parse(readFileSync(p, "utf8"))) !== sha) { console.error(p + ": core sha256 differs from the registry"); process.exit(1); }
console.log("sha256 OK");'
# 3. Every selection replays (the primary draw and, decision D11, the second one), the amendments are consistent
#    (append-only, unique, only of frozen versions, none after a held-out census), and every registered manifest holds
#    its set's tier:
node eval/study/select-holdout.mjs verify
# 4. The product's tier is the manifests' (cargo) and the study's (node):
cargo test -p drift-mine --lib tier && node --test eval/study/tier.test.mjs
```

The held-out `prepare.mjs` (step 5) runs the same history check, refuses a manifest whose tier is not `tier-d7.json`'s (D7 for a primary, D7a for a secondary set), and stops if any proposal's census `tier:` line disagrees with the manifest's tier or is missing.

```sh
git clone https://github.com/GeoffreyFernald/Driftv22 drift-heldout && cd drift-heldout   # a FULL clone (no --depth)
git fetch origin '+refs/heads/*:refs/remotes/origin/*'
git checkout -B heldout-run origin/main && export F=$(git rev-parse HEAD)
git status --porcelain --untracked-files=all          # must print nothing (rule 2)

export CACHE=$HOME/.cache/drift-eval                  # several GB free: the largest repos are a few GB
export DAY=$(date -u +%F)
export RUN_TS=eval/study/runs/heldout-ts-$DAY RUN_PY=eval/study/runs/heldout-py-$DAY
```

If the agent A/B (`eval/agent-ab/v2`) will run on this product too, regenerate its expectations **now**, from a build of `F`, and commit them before step 3. Its `policy-expect.json` is in the frozen tree, so changing it later would change the commit the held-out binary is built from:

```sh
CARGO_TARGET_DIR=$CACHE/tgt-ab cargo build --release --locked --bin drift
node eval/agent-ab/v2/verify-tasks.mjs --drift $CACHE/tgt-ab/release/drift --repos $CACHE/repos --work $CACHE/ab-verify --write-expect
git add eval/agent-ab/v2/policy-expect.json && git commit -m "agent-ab: expectations for the frozen product"   # only eval/ changes
rm -rf $CACHE/tgt-ab $CACHE/ab-verify && export F=$(git rev-parse HEAD)
```

## 1. Gates on F

```sh
fail=0; for f in eval/study/*.test.mjs; do node --test "$f" || fail=1; done; [ $fail = 0 ] || echo "STUDY TESTS FAILED"
node eval/study/select-holdout.mjs verify             # offline: manifests = selection from its frozen inputs; no dev overlap
node -e 'import("./eval/study/lib.mjs").then((l) => { const h = l.sha256Text(l.rubricText("v3")); console.log(h === l.APPROVED_RUBRIC.sha256 ? "rubric v3: the approved text (D6)" : "RUBRIC CHANGED SINCE D6: " + h); })'
cargo fmt --all --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --all --locked
```

The rubric line must print `rubric v3: the approved text (D6)`. `prepare.mjs` refuses a held-out run otherwise, and `prompt.mjs` refuses held-out label and adjudication prompts with another text: a rubric change after D6 needs a new recorded decision.

The test loop must not print `STUDY TESTS FAILED` (it runs every file and fails at the end, as CI does). `verify` must end with `verify: the manifests are exactly what the selections give ...` (once the second draw's record is committed, a plain `verify` also prints `verify: selection heldout2` and replays it). It replays the exclusions from the 7 commits the selection record names. The tags `heldout-exclusion-ref-1` … `heldout-exclusion-ref-7` keep those commits fetchable after their branches are deleted; a clone fetches them by default, and `git fetch origin 'refs/tags/heldout-exclusion-ref-*:refs/tags/heldout-exclusion-ref-*'` fetches them explicitly. If it still says `cannot replay the exclusions`, report that the replay was last done on 2026-11-05, in the PR that added this runbook, and that every other check passed.

## 2. Dry run on dev repos (plumbing only, synthetic labels)

This builds `F`, runs the whole pipeline on two TypeScript dev repos and one Python dev repo (`dry-run-dev.json`), and puts synthetic output in place of labellers A, B and C, the extractor and the matcher. It runs the commands of steps 5–8 in their order, with the held-out run's census tier check (`--strict-tier`). It tests the plumbing and the tables, not Drift. Keep everything outside the repository.

```sh
export DRY=$(mktemp -d) DRIFT_CACHE_DIR=$(mktemp -d)
CARGO_TARGET_DIR=$DRY/target cargo build --release --locked --bin drift && cp $DRY/target/release/drift $DRY/drift && rm -rf $DRY/target
node eval/study/prepare.mjs --drift $DRY/drift --manifest eval/study/dry-run-dev.json --run $DRY/run --cache $CACHE --drift-src . --strict-tier
node eval/study/techcheck.mjs --manifest eval/study/dry-run-dev.json --drift $DRY/drift --cache $CACHE
node eval/study/recall.mjs sources --run $DRY/run
node eval/study/prompt.mjs extract --run $DRY/run && node eval/study/dry-run.mjs fill --run $DRY/run --stage extract && node eval/study/collect.mjs --run $DRY/run --stage extract
for L in A B; do
  node eval/study/prompt.mjs label --run $DRY/run --labeller $L --rubric v3
  node eval/study/dry-run.mjs fill --run $DRY/run --stage label
  node eval/study/collect.mjs --run $DRY/run --stage label --labeller $L --complete
done
node eval/study/agree.mjs --run $DRY/run --json $DRY/run/agreement.json > $DRY/run/agreement.md   # before adjudicate.mjs, which refuses otherwise
node eval/study/adjudicate.mjs --run $DRY/run
node eval/study/prompt.mjs adjudicate --run $DRY/run
node eval/study/dry-run.mjs fill --run $DRY/run --stage adjudicate
node eval/study/collect.mjs --run $DRY/run --stage adjudicate
node eval/study/adjudicate.mjs --run $DRY/run --merge
node eval/study/prompt.mjs match --run $DRY/run && node eval/study/dry-run.mjs fill --run $DRY/run --stage match && node eval/study/collect.mjs --run $DRY/run --stage match
node eval/study/recall.mjs score --run $DRY/run --json $DRY/run/recall.json > $DRY/run/recall.md
node eval/study/metrics.mjs --run $DRY/run --json $DRY/run/metrics.json > $DRY/run/metrics.md
node eval/study/dry-run.mjs check --run $DRY/run --metrics $DRY/run/metrics.json --agreement $DRY/run/agreement.json --recall $DRY/run/recall.json
rm -rf $DRY $DRIFT_CACHE_DIR; unset DRIFT_CACHE_DIR
```

Every command must exit 0, and `dry-run.mjs check` must end with `recall match the synthetic rule`. `metrics.md` must have the "Per language, tier and rule family" table (per-family cluster intervals; no run-local script is needed for them). A failure here is a harness failure: fix it on `main` before `F`, never during the held-out run. `$CACHE/repos/<name>` are the shared dev clones of `eval/run.mjs` (a missing one is cloned; a dirty one is refused, and `--reset-clones` cleans it). `dry-run.mjs` refuses a held-out run.

## 3. Build the frozen binary and record its sha256

`prepare.mjs` builds the binary itself for a held-out run (rule 2): from `git archive` of `F`, with `cargo build --release --locked`, in a fresh target directory. `--only none` builds it and checks every held-out rule without cloning or scanning anything:

```sh
node eval/study/prepare.mjs --manifest eval/holdout-primary.json    --run $RUN_TS --drift-src . --cache $CACHE --only none
node eval/study/prepare.mjs --manifest eval/holdout-primary-py.json --run $RUN_PY --drift-src . --cache $CACHE --only none
for R in $RUN_TS $RUN_PY; do
  node -p "const d = require('./$R/run.json').drift; [d.commit, d.build.tree, d.binary_sha256, d.build.binary].join('  ')"
  sha256sum "$(node -p "require('./$R/run.json').drift.build.binary")"
done
export BIN_TS=$(node -p "require('./$RUN_TS/run.json').drift.build.binary") BIN_PY=$(node -p "require('./$RUN_PY/run.json').drift.build.binary")
```

Check that:

- both `commit`s are `F`, and `sha256sum` of each copy equals its `binary_sha256`;
- the two `binary_sha256` are equal. A clean release build of one commit was bit-identical in two directories on the harness machine (see the PR that added this runbook). If they differ, do not continue: record both, and find out why first. The A/B (step 10) needs the one product the held-out run measured.

Write `F`, the tree, `binary_sha256`, `cargo --version` and `rustc -vV` into both run READMEs (step 9). `run.json` already holds them.

## 4. Clone at the pinned SHAs, and the technical check (rule 1)

`techcheck.mjs` clones each slot's current occupant at its pinned sha, into `$CACHE/repos/<name>` (`prepare.mjs` copies a held-out commit from there, so nothing is downloaded twice). It runs the frozen binary's `drift scan` and reads only its file and parse-error counts. A repo passes if:

- it clones;
- `drift scan` exits 0;
- it has at least 200 parseable files: `files − parse errors` from the scan summary (decision D3).

```sh
node eval/study/techcheck.mjs --manifest eval/holdout-primary.json    --drift $BIN_TS --cache $CACHE --json $RUN_TS/techcheck.json
node eval/study/techcheck.mjs --manifest eval/holdout-primary-py.json --drift $BIN_PY --cache $CACHE --json $RUN_PY/techcheck.json
```

**If every repo passes** (exit 0 twice), go to step 5.

**Exit 3 is an environment error, not a rule-1 failure:** a checkout at the pinned sha that is not clean, a scan that wrote into the checkout, or git failing to create or check out the tree. techcheck stops, names the problem and its fix, and prints **no** swap entry. Fix the machine (usually: delete `$CACHE/repos/<name>`) and rerun. Never swap a repo for it.

**If a repo fails (exit 1),** it failed one of rule 1's three reasons: the clone failed, `drift scan` errored, or fewer than 200 parseable files. techcheck also checks the next reserves, in order, and prints the `replaced` entries rule 1 asks for. The i-th swap uses the i-th reserve, and a failing reserve is itself replaced by the next one. Then:

1. Rerun techcheck once. A clone failure must reproduce: a network outage looks the same.
2. Append the entries, unchanged, to the manifest's `replaced` list. Nothing else in the manifest changes.
3. Run `node eval/study/select-holdout.mjs verify`. It checks the **working tree** only: that the lists are consistent with the core, and that the registry holds the current core hash. It cannot see a coordinated re-sign of the record, the manifests and the registry together; `prepare.mjs`'s history walk (runbook step 3) catches that, and so does the next check.
4. Commit the manifest alone, and check that `git diff --stat $F HEAD` lists only `eval/holdout-primary*.json`, and that `git diff $F HEAD` only appends to `replaced`.
5. Set `F` to the new commit.
6. Delete both run directories. They hold no proposals and no prompts; `prepare.mjs` refuses to reuse a run directory for another commit.
7. Go back to runbook step 3, and confirm that `binary_sha256` is unchanged (the product did not change).

All of this happens **before** step 5, so nobody has seen a proposal of any repo involved.

**If the reserves run out (decision D9, 2026-11-07).** When techcheck prints `no reserve left`, extend the set's reserves with the selection's own procedure before any census, then rerun techcheck:

```sh
node eval/study/select-holdout.mjs extend --set ts --add 8    # or --set py --add 4; --add is the total, a larger one continues the extension
node eval/study/select-holdout.mjs verify                     # replays the extension offline
```

Under D9, `F` is the product tree of `29f4cd6`: changes under `eval/` do not move it. In 4. above, `git diff --stat $F HEAD` must list only files under `eval/`. The tree outside `eval/` must be unchanged (`6c88cac98c0e…`), and so must `binary_sha256`. If the pool runs out, the run goes ahead with the slots filled, and n per part is reported as a deviation.

## 5. Census

**First, the start records.** A held-out census needs its run's start record committed (`<run>/start.json`: `held_out: true`, the manifest, its core, the product commit, `started_at`). The first invocation of each command below writes it and stops. Commit both start records in one commit, push it, and run the commands again. That commit changes only `eval/study/runs/`, so the product commit stays `F` and step 3's binary is reused. Once a start record is committed, no tier amendment is accepted for any set (`heldOutHistoryProblems`: every amendment must be an ancestor of every held-out run record, on any ref). A run that dies mid-census still leaves its committed marker. The step 3 preflight (`--only none`) runs no census and writes no start record, so it does not count.

```sh
node eval/study/prepare.mjs --manifest eval/holdout-primary.json    --run $RUN_TS --drift-src . --cache $CACHE   # writes $RUN_TS/start.json, stops
node eval/study/prepare.mjs --manifest eval/holdout-primary-py.json --run $RUN_PY --drift-src . --cache $CACHE   # writes $RUN_PY/start.json, stops
git add $RUN_TS/start.json $RUN_PY/start.json && git commit -m "held-out run start: $DAY" && git push origin HEAD
git diff --stat $F HEAD                               # must list only the two start.json
node eval/study/prepare.mjs --manifest eval/holdout-primary.json    --run $RUN_TS --drift-src . --cache $CACHE
node eval/study/prepare.mjs --manifest eval/holdout-primary-py.json --run $RUN_PY --drift-src . --cache $CACHE
for R in $RUN_TS $RUN_PY; do
  node -p "const r = require('./$R/run.json'); [r.drift.binary_sha256, r.manifest.set_id, r.manifest.role, r.manifest.holdout].join(' ') + '\n' + r.repos.map((x) => [x.name, x.framework_bucket, x.status, x.proposals].join(' ')).join('\n')"
done
```

- **Reuse.** Each run reuses its step 3 binary only if its sha256 still matches.
- **Exit status.** Each should exit 0, with every repo `ok`. A repo that passed step 4 but fails here (census or `init` errors) is **reported as a failure, with no swap, and the run continues with the rest** (decision D3). `prepare.mjs` then exits 1, but it still writes `run.json` and `queue.json` for the other repos; `prompt.mjs` skips the failed repo, and `metrics.mjs` lists it under the failed repos. Do not rerun `prepare.mjs` to retry it, and do not swap it.
- **Run identity.** `role` must be `primary`, `holdout` `true`, and `drift.commit` `F`.
- **What the run-order check can and cannot do.** It reads this clone. It prevents accidents and honest mistakes: an amendment after a run, a run on a forgotten branch, a run that crashed. Someone who rewrites local history can defeat any local check. The pushed history and the PR record are the audit trail, which is why the start records are pushed before the census.
- **Checkouts.** The run's checkouts are in `$CACHE/runs/<run>-<hash>/repos/`.

Then, optionally, gather the recall sources and extract the documented conventions. Extraction is blind to proposals, so it may run before labelling:

```sh
node eval/study/recall.mjs sources --run $RUN_TS
node eval/study/prompt.mjs extract --run $RUN_TS                  # one fresh extractor agent per prompt
node eval/study/collect.mjs --run $RUN_TS --stage extract
```

(The same for `$RUN_PY`; for at least 3 repos per run also `--labeller E2`.)

## 6. Two blind labellers, A then B

For each run (`R=$RUN_TS`, then `R=$RUN_PY`, or both in parallel; they are different repos):

```sh
node eval/study/prompt.mjs label --run $R --labeller A --rubric v3   # prompts/label/A/<repo>.md, rubric v3 (decision D6)
node -p "[...new Set(require('./$R/prompts/index.json').map((e) => e.rubric))].join(',')"   # must print v3
#   launch ONE FRESH agent per prompt, in that prompt's own empty cwd; each sees only its prompt, the checkout and its outbox
node eval/study/collect.mjs --run $R --stage label --labeller A --complete   # INVALID or MISSING: relaunch that agent (never edit its output)
node eval/study/prompt.mjs label --run $R --labeller B       # renders B only for repos whose A output is collected
#   launch ONE FRESH agent per prompt, in its own cwd, preferably another model than A
node eval/study/collect.mjs --run $R --stage label --complete   # must exit 0: every repo has its A and B set
node eval/study/agree.mjs --run $R --json $R/agreement.json > $R/agreement.md    # before adjudication; never recomputed; refuses incomplete sets
```

- **Complete sets first.** `agree.mjs` and `metrics.mjs` refuse while a repo lacks its A or B labels or has a label prompt not yet collected. `--allow-incomplete TEXT` is recorded in their outputs and makes `metrics.json` ineligible for a headline; on a held-out run use it only for a labeller that cannot run at all (then `adjudicate.mjs --exclude-repos`), and report it as a deviation.
- **Agreement first.** `agree.mjs` records the sha256 of the A and B label sets in `agreement.json`. `adjudicate.mjs` (step 7) refuses to write its queue without that file, or when it is the agreement of other labels; once the queue exists, `agree.mjs --run` refuses. Do not use `--after-adjudication` on a held-out run: if agreement was skipped, report it as a protocol deviation.

- Never run A and B of one repo at the same time. `prompt.mjs` enforces it.
- The rubric is v3 (decision D6) for A, B and C. `prompt.mjs` keeps one rubric per run and records it per prompt; `collect.mjs` rejects records that name another.
- Prefer a sandbox that mounts only the checkout and the one outbox (README, "Launching").
- Record which model ran A and which ran B in `$R/README.md`.

## 7. Adjudication: C, on the disagreements only

```sh
node eval/study/adjudicate.mjs --run $R                      # adjudication/queue.json; needs $R/agreement.json of these labels (step 6)
node eval/study/prompt.mjs adjudicate --run $R               # prompts/adjudicate/C/<repo>.md
#   launch one fresh agent per prompt (not an A or B session)
node eval/study/collect.mjs --run $R --stage adjudicate --complete
node eval/study/adjudicate.mjs --run $R --merge              # final.jsonl
```

Then recall, which is blind to labels (`prompt.mjs` renders match prompts only after `final.jsonl` exists):

```sh
node eval/study/prompt.mjs match --run $R && node eval/study/collect.mjs --run $R --stage match
node eval/study/recall.mjs score --run $R --json $R/recall.json > $R/recall.md
```

## 8. Metrics

```sh
node eval/study/metrics.mjs --run $RUN_TS --json $RUN_TS/metrics.json > $RUN_TS/metrics.md
node eval/study/metrics.mjs --run $RUN_PY --json $RUN_PY/metrics.json > $RUN_PY/metrics.md
```

Check that `metrics.json` has `headline_eligible: true` and `tier.pre_registered: true`. Never pass `--tier-min` for a headline: it only adds an exploratory row.

## 9. What to report

Report per language: TypeScript/JavaScript from `$RUN_TS`, Python from `$RUN_PY`. Use the "Per language and tier" table of each `metrics.md` (in JSON, `by_language[]`).

**The criterion (decision D1).** The default-tier accept target is met when its **point estimate, per language**, is ≥ 95%, over all shown with unlabelled counted as WRONG. The bold default-tier cell of each language states the criterion and the verdict (`MET` / `NOT MET`; in JSON, `by_language[].target.met`). Publish the Wilson and cluster intervals next to every point estimate. Pooled TypeScript/JavaScript + Python figures, if computed, are secondary only.

**The not-wrong criterion (decision D4, product lead; the founder may override it before the census).** The not-wrong target is judged the same way: it is met when its **point estimate, per language**, is ≥ 95%, over all shown, both tiers, with unlabelled counted as WRONG. The bold "All shown (both tiers)" Not-wrong cell of each language states the criterion and the verdict (in JSON, `by_language[].not_wrong_target.met`). The pooled row is secondary, with no verdict. If the founder overrides D4, the override must be in the README's decision log before step 5.

| Number | Definition (pre-registered) | Where |
| --- | --- | --- |
| **Default-tier accept** (target ≥ 95%) | ACCEPT / shown in the default tier (rule 5 as amended by D5 and D7, `tier-d7.json`), unlabelled counted as WRONG; Python has no default tier under D7, so its row has n = 0 and `metrics.mjs` prints "no verdict (no default-tier proposals, n = 0)" (`met: null`): report it as "no default tier (D7)", never as a rate | row "Default tier", column Accept; `by_language[].default_tier.accept_shown` |
| **Not-wrong, overall** (target ≥ 95%) | (ACCEPT + TRIVIAL) / all shown, both tiers, unlabelled counted as WRONG | row "All shown (both tiers)", column Not-wrong; `by_language[].overall.not_wrong_shown`, verdict `by_language[].not_wrong_target` (D4) |
| Suggestion tier, accept and not-wrong | the same, over the suggestion tier | row "Suggestion tier" |

- **Intervals.** Give every rate with its n:
  - the Wilson 95% interval (`lo`, `hi`);
  - both repo-cluster 95% intervals, the percentile bootstrap (`boot`) and the cluster-t (`t`), with the number of repos.

  Quote the **wider cluster interval** as the interval. With 10–18 clusters, Wilson is too narrow.
- **With every precision number** (README step 7), report:
  - agreement (`agreement.md`: exact, κ with its interval, the confusion matrix);
  - yield (accepted per repo: mean, median, repos with none);
  - recall (`recall.md`, strict and lenient, lint and prose split).
- **Per rule family.** The "Per language, tier and rule family" table of `metrics.md` (`by_language[].families[]` in JSON) gives each family's rates per tier with Wilson and both cluster intervals. It is secondary: no verdict.
- **Course-material repos (decision D2).** Flag `computer-science-fundamentals` (TypeScript/JavaScript) and `cs146s_cn` (Python) in the report: they look like course material by name and stay in, as pre-registered. Give the per-language results with and without them, from the "Sensitivity" table of `metrics.md` (`sensitivity` in JSON). The with-them figures are the result.
- **Failed repos (decision D3).** List every repo that failed census or `init` as a failure ("N repos failed" in `metrics.md`, `failed_repos` in JSON), with no swap.
- **Also report:**
  - the per-framework-bucket table;
  - any `replaced` swap and why (from `techcheck.json`);
  - any repo that failed;
  - the unlabelled count, if any;
  - `F`, the tree and `binary_sha256`;
  - the models used for A, B and C.
- **Commit the run directories** as README step 7 lists, each with a `README.md`.

## 10. The A/B uses the same frozen binary

The agent A/B measures the same product, so it runs on the held-out run's binary, not on a fresh build:

```sh
export DRIFT=$BIN_TS && sha256sum $DRIFT      # = binary_sha256 of both run.json
node eval/agent-ab/v2/selftest.mjs --drift $DRIFT --repos $CACHE/repos --work $WORK
node eval/agent-ab/v2/run.mjs      --drift $DRIFT --repos $CACHE/repos --work $WORK --models ... --repeats 5 ...
```

- **Keep the binary.** It lives in `$CACHE/runs/<run>-<hash>/drift-<first 12 characters of F>`. Keep it until both the held-out results and the A/B results are reported.
- **A/B runs on dev repos only.** It runs on the dev repos (`eval/repos.json`), never on a held-out repo.
- **The policy is keyed on the binary's sha256.** Its expectations were regenerated against `F` in step 0. A mismatch means it did not run on the frozen product.

## The second held-out sets (decision D11)

`eval/holdout-2-2026-11-07.json` (`ts-heldout2-2026-11-07`, 18 repos, 18 reserves) and `eval/holdout-2-2026-11-07-py.json` (`py-heldout2-2026-11-07`, 10 repos, 12 reserves) were drawn on 2026-11-07 for the round-9 freeze (README decision D11). Selection only: nothing was cloned, scanned or labelled. Their run follows steps 0–10 above with these manifests in place of the primary ones, and these differences:

- **Run directories:** `eval/study/runs/heldout2-ts-$DAY` and `eval/study/runs/heldout2-py-$DAY`.
- **`F`** is the round-9 freeze commit, checked as in the freeze checklist. D9's freeze scope (the product tree of `29f4cd6`) belongs to the primary run and does not apply.
- **Verify:** `node eval/study/select-holdout.mjs verify` replays both selections; `--selection heldout2` replays only this one. Its record names every ref of the Drift repository at the draw (`exclusions.refs`), and the replay needs each of those commits. Those not reachable from `main` are to be kept fetchable by tags `heldout2-exclusion-ref-*`, as `heldout-exclusion-ref-*` keep the primary draw's (`git fetch origin 'refs/tags/heldout2-exclusion-ref-*:refs/tags/heldout2-exclusion-ref-*'`); until those tags exist, the replay needs the branches.
- **Step 4, reserves:** used in order, as rule 1 says. There is no `extend` for these sets: their reserves were fixed before the draw, and no amendment can be registered once a held-out run record exists. If the reserves run out, the run goes ahead with the slots filled, and n per part is reported as a deviation.
- **Tier:** `tier-d7.json`'s, frozen in the manifests. A different tier at the freeze cannot be registered as an amendment (`heldOutHistoryProblems`); it needs a new decision first.
- **D2:** no course-material repo is registered for these sets, so the "Sensitivity" table has none to leave out.
- **D10.3:** the verifier's prompt, model and pass rule are fixed and recorded before step 5 (PLAN-PAR D10.3).

## The dev3 blind dev pool (PLAN-R10 section 3.1)

`select-holdout.mjs --selection dev3` (README, "The dev3 blind dev pool") draws 12 TS/JS and 8 Python repos, role `dev`, with this runbook's selection procedure and exclusions. Only the dev3 operator runs these steps or opens their outputs (`eval/dev3*`, `eval/study/runs/dev3*`).

1. **Pre-register.** The seed and spec are committed and pushed before the draw (`node eval/study/select-holdout.mjs spec --selection dev3` prints them).
2. **Draw.** `git fetch driftv22`, so the exclusions see every branch; then `node eval/study/select-holdout.mjs fetch --selection dev3` and commit the record; then `write --selection dev3` and commit the manifests and the pool's registry. `write` never touches `holdout-manifests.json`.
3. **Technical check (rule 1).** `techcheck.mjs --manifest eval/dev3-2026-11-08.json` (and `-py.json`) with a `build-verified.sh` build of current main, as step 4 above; swaps use the fixed reserves in order, are appended to `replaced` unchanged, and are committed with the manifests alone. There is no extension: if the reserves run out, n per part is reported as a deviation.
4. **Verify.** `node eval/study/select-holdout.mjs verify` replays every selection, dev3 included; `--selection dev3` replays only it.
5. **At the round-10 freeze.** Census and blind labelling once, on the frozen binary, under `eval/study/runs/dev3-*`.

## The dev4 blind dev pool (PLAN-R11 section 4.1)

`select-holdout.mjs --selection dev4` (README, "The dev4 blind dev pool") draws 36 TS/JS and 24 Python repos, role `dev`, as dev3 was drawn. Only the dev4 operator runs these steps or opens their outputs (`eval/dev4*`, `eval/study/runs/dev4*`).

1. **Pre-register.** `PREREG-F11-dev4-check.md` first, then the seed and spec (`node eval/study/select-holdout.mjs spec --selection dev4`), each committed and pushed before the draw.
2. **Draw.** `git fetch driftv22`; then `fetch --selection dev4`, commit the record; then `write --selection dev4`, commit the manifests and the registry.
3. **Technical check (rule 1).** `techcheck.mjs --manifest eval/dev4-2026-11-08.json` (and `-py.json`) with a `build-verified.sh` build of current main, with `--prune` (each checkout deleted once checked, one repo on disk at a time) and `--min-free-gb 3` (too little disk is an environment error, never a swap). Swaps use the fixed reserves in order, are appended to `replaced` unchanged and committed with the manifests alone. There is no extension: if the reserves run out, n per part is reported as a deviation.
4. **Verify.** `node eval/study/select-holdout.mjs verify` replays every selection; `--selection dev4` replays only it.
5. **At the round-11 freeze.** §1 and §5 (c) of the pre-registration filled in and pushed, then census and blind labelling once, on the frozen binary, under `eval/study/runs/dev4-*`.
