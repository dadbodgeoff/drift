# Dev relabel 4: the dev cards changed since their newest label, at main 2c81ba4 (2026-11-07)

**Dev data, in-sample. This is not a held-out run and carries no verdict.**

**Status: staged, not labelled.** 43 cards need a fresh v3 label; 187 labels are carried. Labeller A's prompts are rendered; nothing has been labelled.

## What
This run stages a blind relabel, under rubric v3, of every dev card shown at main `2c81ba4` whose newest label no longer fits. It is prepared exactly as `dev-v3-relabel3-2026-11-07` was, with that run's `stage.mjs` (copied here) and carry rule.
- **Product.** Main `2c81ba4` is after round 6 (#89–#103): TS `LOWERING_VERSION` 36, Python 15, facts schema 10.
- **Coverage.** All three dev parts:
  - `ts`: the 16 repos of `eval/repos.json`;
  - `py`: 6 repos of `eval/repos-py.json`, without polar and CTFd;
  - `py2`: the 12 repos of `eval/repos-py-2.json`.

| Part | Shown | Default tier (shown / carried / to label) | Suggestion tier (shown / carried / to label) | To label |
|---|---|---|---|---|
| ts | 147 | 30 / 28 / **2** | 117 / 94 / **23** | **25** in 9 repos |
| py | 22 | 0 | 22 / 18 / **4** | **4** in 1 repo |
| py2 | 61 | 0 | 61 / 47 / **14** | **14** in 6 repos |
| **All** | 230 | 30 / 28 / 2 | 200 / 159 / 41 | **43** |

Cards to label, per repo:
- **ts:** midday 8, infisical 5, cal.com 4, twenty 2, formbricks 2, documenso 1, ai 1, supabase 1, novu 1.
- **py:** netbox 4.
- **py2:** ralph 4, Misago 4, InvenTree 2, lotus 2, wger 1, open-wearables 1.

By reason:

| Reason | ts | py | py2 |
|---|---|---|---|
| `new`: no label for the id | 13 | 0 | 0 |
| `outliers`: an outlier added or removed | 8 | 4 | 14 |
| `tier`: the D7 tier changed | 0 | 0 | 0 |
| `other`: another line changed (outliers and tier unchanged) | 2 | 0 | 0 |
| `example`: only the example changed (besides lift) | 2 | 0 | 0 |

### Which product change each card comes from
Attributed from the census each round-6 PR recorded before and after its change (holders/total and outliers of the same id).
- **Default tier (2, both new, both cal.com call wrappers):**
  - `cal.com/D-85e09a` (#91): HTTP handlers in `app/**` wrapped in `defaultResponderForAppDir()`;
  - `cal.com/D-594d38` (#102): the tRPC builder card that replaces `D-c54406` (no longer shown).
- **#91 (function factories), 6 cards:**
  - new: `formbricks/D-3bb3c1`, `formbricks/D-66d37f`, `ai/D-4683f7`;
  - changed: `cal.com/D-8d7d13` (`other`: 40/40 → 44/44 holders, still 0 outliers), `infisical/D-156a6f` (11 → 10 outliers) and `infisical/D-ac787f` (`other`: 309/345 → 312/348, same 36 outliers).
- **#102 (tRPC builders), 1 suggestion card:** `cal.com/D-42ab67` is shown again (it replaces `D-bcef5c`, no longer shown). Its newest label is `relabel2`'s, on a card with 3 outliers out of 129; it now lists 29 out of 171, so it is relabelled.
- **#99 (TS suggestion precision), 16 cards:**
  - new: `twenty/D-81a1f5`, `twenty/D-532878`, `documenso/D-d7fae5`, `novu/D-6ded6b`, `midday/D-8fbbad`, `D-48f0ae`, `D-a45d35`, `D-798f44`;
  - shown again with a changed card: `infisical/D-536c03`, last labelled in `dev-v3-2026-11-06` (7 → 6 outliers);
  - outliers removed: `supabase/D-922bc7` (1 → 0), `midday/D-7da2b9` (2 → 0), `midday/D-afc38b` (4 → 2), `infisical/D-d9b44e` (1 → 0), `infisical/D-1b2542` (1 → 0);
  - only the example changed: `midday/D-98e729`, `midday/D-495f56`;
  - new against #99's own base, but **carried**: `cal.com/D-e5e923` (card identical to its `relabel3` card, at `e9c6058`) and `infisical/D-4be5e9` (lift and rank only, against `dev-v3-2026-11-06`).
  - Python: `netbox/D-76eb6b` lost one outlier (2 → 1, `netbox/netbox/graphql/types.py#ContentTypeType`) between #97's final census and #99's.
- **#97 (Python precision), 17 cards:** every one is an outlier removal:
  - py: `netbox/D-58913a` (12 → 9), `D-afb64d` (4 → 1) and `D-937c0c` (1 → 0);
  - py2: `InvenTree/D-6f225b` (8 → 7), `D-f31910` (6 → 2); `ralph/D-4529f9` (5 → 1), `D-5b6f70` (3 → 0), `D-b1df5c` (5 → 1), `D-43f01e` (3 → 1); `Misago/D-c9ae1e` (1 → 0), `D-e72fc8` (1 → 0), `D-b4e5ff` (1 → 0), `D-d8703c` (6 → 0); `wger/D-db04dc` (3 → 0); `lotus/D-26d6a0` (7 → 6), `D-1cbdac` (23 → 16); `open-wearables/D-6606a8` (3 → 1).
  - Seven of them now list 0 outliers. All are still shown, so all are relabelled.
  - #97's hide decision is why 1 py and 16 py2 labelled cards are no longer shown.
- **#103 (security):** no card to label (no id or tier change). The novu cards that differ from `relabel3` in lift only (`D-36a604`, `D-3f3e16`, `D-52c44b`) are carried.
- **No longer shown:** 27 ts, 1 py and 16 py2 uids that `relabel3` showed, including `cal.com/D-c54406` and `D-bcef5c`.

## Why
Round 6 added cards and changed outliers, including two new default-tier cards. The carried-only figures below count every such card as unlabelled, that is, as WRONG.

## Protocol
- **Product.** The run records commit `2c81ba491d09…` (main, no merge), with `dirty: false`.
  - **Binary.** Built by `build-verified.sh` with codegen-units 47. Its sha256 starts `5d0cd386c9e7…` and its census `commit` tag is `cgu47-2c81ba4-1794051240`.
  - **Behaviour probe.** The census shows what round 6 added, and `e9c6058` did not have: `cal.com/D-594d38` and `D-85e09a` (default tier), and `D-42ab67` with 29 outliers.
- **Census.** `prepare.mjs` ran with `--all-outliers --max 15` and pool `--max 200`; all 34 repos were `ok`. `census-json/<repo>.json` holds `census --json --max 15` of each repo, from the same binary. Everything ran one repo at a time, with a private `DRIFT_CACHE_DIR` that was deleted after each repo.
- **Checkouts (one change from relabel3, for disk).** Each census checkout is a fresh repository at the pin. Its objects come from the dev clone through `objects/info/alternates`, read-only, with the clone's `shallow` file. In relabel3 they came from a copied pack (`git fetch --depth 1 file://…`); infisical's pack alone is about 1 GB.
  - Git never writes into an alternate, and the checkout's files have their own inodes.
  - Each checkout was deleted after its census. `restage.sh` also printed `df -h /` before each repo and waited while less than 1.5 GB was free.
  - Probe: for `nest` and `simplelogin`, a `git fetch --depth 1` checkout gives a `census --json` byte-identical to `census-json/` except for `root`.
- **The dev clones.** They were only read; each is at its pin.
  - The py2 clone `Misago` still holds the ignored `misago/collections/__pycache__/…pyc` noted in relabel3.
  - Because of it, py2's labellers open private clean checkouts at the pins, fetched as in relabel3: `<scratchpad>/co-ebf82b/py2/<repo>`, kept for labelling. The ts and py labellers open the dev clones.
- **Newest label** (`sources.json`). For each shown uid, the label comes from the first of these runs that has one:
  - ts: `dev-v3-relabel3-2026-11-07/ts`, then `dev-v3-relabel2-2026-11-07/ts`, `dev-v3-relabel-2026-11-06/ts`, `dev-v3-2026-11-06/ts`;
  - py: `dev-v3-relabel3-2026-11-07/py`, then `dev-v3-2026-11-06/py`;
  - py2: `dev-v3-relabel3-2026-11-07/py2`, then `dev-v3-2026-11-06/py2`.

  The card is compared with that run's own census: its `queue.json` block and its `views/d7` tier. Every labelled card's repo is at the same pin as now, and every label is v3 at the approved rubric text (no `pin` or `rubric` relabels).
- **Carry rule: relabel3's, unchanged** (the lead's decision, 2026-11-07). A label is carried only when both hold:
  - the labeller-visible card (the census block without its rank) is byte-identical to the labelled card, except for the lift figure of its evidence line;
  - the D7 tier is the same.

  Of the 187 carried labels, 28 differ in lift only, some of them also in rank.
- **Blinding.** Each prompt holds only its own repo's uids, with no tier, rank, carried or relabel wording, and the outbox paths are neutral (`<scratchpad>/lbx-ebf82b/outbox/<uuid>/out.jsonl`). The earlier labels of the cards to relabel are written nowhere in this run, and the stager read none of them: only `stage.mjs` compared cards.
- **Working directories (#92).** `prompt.mjs` gave every prompt a fresh, empty working directory, `<scratchpad>/lbx-ebf82b/workdirs/<uuid>/`, recorded as `cwd` in `prompts/index.json`. Launch each agent there, never in a worktree. The orchestrator also has neutral copies of the prompts (random file names, outside the repository) and a map that lists, for each prompt: part, repo, labeller, prompt, `cwd` and outbox.
- **Labelling (to do).**
  - **Labellers.** A runs on the session's default model, B on a different, smaller model. Each (labeller, repo) prompt goes to one fresh agent, started in its `cwd` and given only its prompt.
  - **B after A.** `prompt.mjs` renders B for a repo only after A's output for that repo is collected, so the B prompts (16) are not rendered yet. Neither are the C prompts: those come after `adjudicate.mjs`.
  - **Steps:**
    1. `collect.mjs --stage label --labeller A --complete`;
    2. `prompt.mjs label --labeller B`, launch B, then `collect.mjs --stage label --complete`;
    3. `agree.mjs` (it refuses incomplete sets);
    4. `adjudicate.mjs`, then `prompt.mjs adjudicate`, launch C, `collect.mjs --stage adjudicate --complete`, then `adjudicate.mjs --merge`;
    5. `node eval/study/stage.mjs final --run <part>`;
    6. `metrics.mjs` on `<part>/views/d7`.

## Files
| Path | What |
|---|---|
| `<part>/run.json`, `queue.json`, `proposals/`, `pool/` | `prepare.mjs` output |
| `census-json/<repo>.json` | `census --json --max 15`, same binary |
| `<part>/carried.jsonl` | the carried labels, with `carried_from`, `carried_card` and `carried_reason`: 122 ts, 18 py, 47 py2 |
| `<part>/relabel/{run,queue}.json` | the uids to label, and the checkouts the labellers open |
| `<part>/relabel/prompts/label/A/<repo>.md`, `prompts/index.json` | labeller A's prompts, 16 (B and C not rendered yet) |
| `<part>/views/d7/` | decision D7's tier as a derived view, and `metrics-carried-only.{md,json}` |
| `batches.json` | one batch per (labeller, repo): 16 repos × A and B = 32 |
| `stage.json` | per part and tier: shown, carried, and to label by reason; per card: source, outliers before and now, and what changed (no labels) |
| `stage.mjs` | relabel3's staging script, copied by `restage.sh`; label sources from `sources.json` |
| `sources.json` | the label runs, newest first |
| `restage.sh` | relabel3's `restage.sh` with the two disk changes above |

## Carried labels only: what is at stake
These come from `metrics.mjs` on `<part>/views/d7` with `--labels <part>/carried.jsonl --allow-incomplete`, with the cards to label counted as WRONG. They are not results.

| Part | Tier | Shown | Carried (A / T / W) | Unlabelled | Accept, unlabelled = WRONG | Not-wrong, unlabelled = WRONG |
|---|---|---|---|---|---|---|
| ts | Default | 30 | 28 (28 / 0 / 0) | 2 | **93.3%** (28/30) | 93.3% |
| ts | Suggestion | 117 | 94 (52 / 1 / 41) | 23 | 44.4% | 45.3% |
| ts | All shown | 147 | 122 (80 / 1 / 41) | 25 | 54.4% | **55.1%** |
| py | All (suggestion) | 22 | 18 (11 / 0 / 7) | 4 | 50.0% | 50.0% |
| py2 | All (suggestion) | 61 | 47 (21 / 1 / 25) | 14 | 34.4% | 36.1% |

- **TS default tier.** The two unlabelled cards are the new cal.com call wrappers `D-85e09a` and `D-594d38`. The tier reads 30/30 if both come back ACCEPT, 29/30 (96.7%) with one WRONG and 28/30 (93.3%) with two. The tier was 29/29 at `e9c6058`.

## Commands (this run)
```sh
git worktree add /home/user/drift-wt/relabel4 -b ws/relabel4 2c81ba4
# sources.json (above), then:
SCRATCH=$S/relabel4 eval/study/runs/dev-v3-relabel4-2026-11-07/restage.sh . dev-v3-relabel4-2026-11-07 47
```

## Results (labelled 2026-11-07, main 2c81ba4)

Dev set, in-sample, not held-out: these give no verdict. Every shown proposal is labelled (0 unlabelled): 43 cards relabelled blind (A, then B, C on disagreements), 187 carried. Full tables: `<part>/metrics.json` (`metrics.mjs` on `<part>/views/d7` with `--labels <part>/final.jsonl`).

| TypeScript/JavaScript, 16 dev repos | Shown | Accepted | Not wrong |
|---|---|---|---|
| Default tier | 30 (8 repos) | 100% (30); Wilson 95% 88.6–100% | 100% (30) |
| … call wrappers | 20 | 100% (20) | 100% |
| … layering (imports avoided) | 10 | 100% (10) | 100% |
| Suggestion tier | 117 | 53.0% (62) | 55.6% (65) |
| All shown | 147 | 62.6% (92) | 64.6% (95) |

| Python, Python proposals only | Shown | Accepted | Not wrong |
|---|---|---|---|
| py (`eval/repos-py.json`, 6 of 8 repos) | 21 | 57.1% (12) | 57.1% |
| py2 (`eval/repos-py-2.json`, 12 repos) | 42 | 45.2% (19) | 47.6% (20) |

For comparison, relabel3 at `e9c6058`: ts default 100% (29/29), suggestion 45.0% / 46.5%, all shown 55.1% / 56.3%; Python rows 54.5% (12/22) and 26.3% (15/57). The two new default-tier cards (cal.com D-85e09a from #91, D-594d38 from #102) were both labelled ACCEPT by A and B.

Agreement (computed before adjudication on complete A and B sets): ts 80.0%, κ 0.65 (20/25); py 75.0% (3/4); py2 92.9%, κ 0.84 (13/14). C adjudicated 7: sided with A 6, B 1.

## Deviations

- B prompts for documenso, ai and novu were rendered, launched, then re-rendered by a second `next.sh ts B` (which re-renders every uncollected B). The first three B agents were stopped (documenso, novu) or had finished (ai); prompt.mjs removed their superseded outboxes, so no output from them survived or was read. The current prompts were launched fresh; afterwards every B prompt was rendered per repo with `--repo`.
- The "two other members" check rejected outputs from A (cal.com, midday) and B (formbricks, infisical, cal.com, InvenTree, Misago, lotus, midday); each was returned to the same labeller with only the validator's message, and the redone records were collected. One C output (ai) was returned for a malformed `sided_with` value only.
- Validator fix (eval/study/lib.mjs, test added and mutation-checked): for a role of kind `package`, other packages' manifests count as other members; before, a package role's labeller could never satisfy rubric v3 "What to open" 3. Applied to every output collected after the change (midday A record 6 was the only record it affected).
- Some labellers' completion messages to the orchestrator included label counts; no label or rationale was passed to another labeller.
