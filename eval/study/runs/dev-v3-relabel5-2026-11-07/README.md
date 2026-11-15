# Dev relabel 5: every card the round-9 product shows, at main de57356 (2026-11-07)

**Dev data, in-sample. This is not a held-out run and carries no verdict.**

**Status: labelled (2026-11-08); verifier run and decided.** All 224 shown cards have a v3 label: 116 fresh (A, then B, with C on the 16 disagreements) and 108 reused. All 194 suggestion-tier cards have a verifier verdict. Results are below, after the pre-registration; deviations are at the end.

## What
- **Product.** Main `de57356`, the end of round 9:
  - #115 B, agent text;
  - #117 C, comply-only flags and TS `LOWERING_VERSION` 37;
  - #118 F, review surface;
  - #119 G, review log;
  - #120 D, role stability and card merging;
  - #116 E, the verifier source, off by default.

  Facts schema 10, `selector_version` 3, Python `LOWERING_VERSION` 16.
- **Coverage.** All 34 dev clones, never polar or CTFd:
  - `ts`: the 16 repos of `eval/repos.json`;
  - `py`: 6 repos of `eval/repos-py.json`;
  - `py2`: the 12 repos of `eval/repos-py-2.json`.
- **Cards.** Every card shown: `census --all-outliers --all --max 15` (prepare.mjs), the same set as `census-json/<repo>.json` (`census --json --max 15`).
- **Labelling.** A runs on the session's default model and B on a different, smaller model, blind. C, on the default model, adjudicates their disagreements. Rubric v3.
- **Verifier.** The first D10.3 check runs beside the labelling: the frozen prompt v3 on every shown suggestion-tier card (below).

| Part | Shown | Default tier (shown / reused / to label) | Suggestion tier (shown / reused / to label) | To label |
|---|---|---|---|---|
| ts | 147 | 30 / 15 / **15** | 117 / 52 / **65** | **80** in 12 repos |
| py | 17 | 0 | 17 / 5 / **12** | **12** in 3 repos |
| py2 | 60 | 0 | 60 / 36 / **24** | **24** in 10 repos |
| **All** | 224 | 30 / 15 / 15 | 194 / 93 / 101 | **116** |

Reused labels: 108. Every one is on a card byte-identical to the labelled card (`card: identical` in `stage.json`).

Cards to label, per repo:
- **ts:** dub 14, novu 12, infisical 11, cal.com 8, formbricks 7, documenso 6, supabase 6, twenty 5, midday 5, ai 3, immich 2, nest 1.
- **py:** netbox 10, saleor 1, fastapi 1.
- **py2:** InvenTree 6, ralph 4, Misago 4, paperless-ngx 3, tasking-manager 2, Django-CRM 1, wger 1, lotus 1, pontoon 1, changedetection.io 1.

By reason (`stage.json`):

| Reason | ts | py | py2 |
|---|---|---|---|
| `new`: no label for the id | 5 | 4 | 19 |
| `outliers`: an outlier added or removed | 7 | 2 | 0 |
| `other`: the statement or another line changed | 40 | 6 | 5 |
| `lift`: only the lift figure changed [STRICT, new in relabel5] | 28 (13 default, 15 suggestion) | 0 | 0 |
| `tier`, `example`, `pin`, `rubric` | 0 | 0 | 0 |

- **`other`.** Every ts `other` and 10 of 11 Python ones are a changed statement: W2/C now write exemptions into it (", except a companion …", "(declared dependencies … excepted)"). The other Python one is `netbox/D-bc0c7d`, where another line changed.
- **`new`.** Among them is D's merged card `Django-CRM/D-39c60a` ("HTTP handlers in cases/** and leads/** …"), the behaviour probe that the census ran #120's code.
- **No longer shown.** 54 ts, 25 py and 39 py2 uids that relabel4 labelled.

## Protocol (as relabel4, with the changes marked)
- **Binary.**
  - Built by `build-verified.sh` with codegen-units 65; sha256 `0d4ec8f54c10…`.
  - Its census `commit` tag is `cgu65-de57356-1794092874`, and the run records commit `de57356738f2…` with `dirty: false`.
  - Behaviour probe: the merged card above, and every suggestion card's `agents:` line (W0, #110).
- **Census.** `restage.sh`, relabel4's with the changes in its header: it takes the prebuilt binary, runs this run's `stage.mjs`, and builds the verifier payloads. It ran one repo at a time:
  - checkouts borrow the dev clone's objects through `alternates`, read-only;
  - a private `DRIFT_CACHE_DIR` was deleted after each repo;
  - it waited while free memory was under 4 GB or free disk under 1.5 GB.

  All 34 repos were `ok`. The py2 clone `Misago` still holds an ignored `__pycache__`, so py2's labellers open private clean checkouts in `<scratchpad>/co-de3ffe/py2`; ts and py open the dev clones.
- **Label sources** (`sources.json`, newest first). For ts: relabel4, relabel3, relabel2, relabel, dev-v3. For py and py2: relabel4, relabel3, dev-v3.
- **Reuse rule [STRICT, the lead's for relabel5].** A label is reused only when both of these hold:
  - the id is the same, and the card a labeller sees is byte-identical to the labelled card except for its rank: statement, evidence (holders/total, lower bound **and lift**), split, example, outliers, exempt list, every line in order;
  - the D7 tier is the same.

  relabel3 and relabel4 also carried a card whose lift figure alone changed. relabel5 relabels it (reason `lift`).
- **What a labeller sees (changed, blinding).** Since W0 the census prints an `agents:` line on each card: whether agents are shown it and, if not, the family's labelled accept rate ("family below admission bar: 56% of 37"). That rate comes from earlier labels.
  - `prompt.mjs` now drops the line through `lib.mjs labellerCard`, which has a test and was mutation-checked.
  - `stage.mjs` compares cards without it, since labellers never see it.
  - The verifier's card drops it too (`verify.rs card_block`).
- **Blinding.** As in relabel4:
  - each prompt holds only its repo's uids, with no tier, rank, carried or relabel wording;
  - outboxes (`<scratchpad>/lbx-4770a7/outbox/<uuid>/out.jsonl`) and working directories (`…/workdirs/<uuid>/`) are neutral;
  - the earlier labels of relabelled cards are written nowhere in this run;
  - the lead launches each prompt from a neutral copy (`<scratchpad>/relabel5/p/<key>.md`), using the map `<scratchpad>/relabel5/labeller-map.json`, which gives part, repo, labeller, prompt, `cwd` and outbox.
- **Order.** `prompt.mjs` renders B for a repo only after A's output for that repo is collected. C comes after `agree.mjs` and `adjudicate.mjs`. Steps as relabel4: collect A, then render and launch B, collect, `agree.mjs`, `adjudicate.mjs`, C, `adjudicate.mjs --merge`, `stage.mjs final`, `metrics.mjs`, `d10.mjs`.

### The verifier (D10.3, first check)
- **Payloads.** In each census checkout, after the census, `restage.sh` ran:
  1. `drift init --max 15` (the census's cap);
  2. `drift review --accept <every shown suggestion-tier id>`;
  3. `agents.verify: on`;
  4. the product's MCP server (`drift mcp`, tool `drift_verify_card` with only `id`), once per card.

  This gave 194 payloads for 194 suggestion-tier cards. Each payload's outlier count equals the census's, and its system prompt is v3 (sha256 `8298c26d…`).
- **Why `init --max 15`.** With `--max 200`, documenso's policy holds the merged card `D-2c517d` instead of the `D-a10f62` the census shows: D's merging depends on the cap. The first four repos' payloads were rebuilt at `--max 15`. For dub, the payloads were identical either way.
- **Payloads stay outside the repository.** They quote repository code, so they are in `<scratchpad>/relabel5/verifier/payloads/`. The run records `verifier/cards.jsonl`: per card, the content hash, the message's sha256, the excerpted members and the tags.
- **Samples (`vrun.py`, the lead's instruction).** 3 per card, 582 in all. Each sample is one fresh headless CLI process (`claude -p`) that runs:
  - on R6's frozen small model, given by the same alias on the command line;
  - with every tool disabled (`--tools ""`), no MCP servers, no settings and no session persistence, in an empty directory;
  - with the system prompt = the payload's `system_prompt` (v3, checked byte-for-byte by sha256) and the user turn = the payload's `message` on stdin. Nothing else is in context.

  At most 3 calls run at once. A failed call (non-zero exit, an error result, or a reply that `Sample::parse` would reject) is retried once in a fresh process. Each sample's record is kept in `<scratchpad>/relabel5/vrun/raw/`: the model alias and the model the CLI reports, the CLI version, every attempt's exit status, raw reply, cost and duration. `verifier/replies.jsonl` holds the replies.
- **No labels.** The verifier is frozen. `vrun.py` and `decide.sh` read no label; `verifier.mjs score` runs only once the lead says labelling is final.
- **Tags.** 94 cards are tuned (in R6's tune split) and 100 untuned. Of the untuned, 72 were in R6's frozen test split and 28 in neither split (R6-unseen).
- **Decision.** `decide.sh` rebuilds each checkout and sends the 3 replies back through `drift_verify_card`. The product refuses a payload whose content hash changed, then runs `Sample::parse` and `decide` (2 of 3) and caches the verdict. `mcp_decide.py` reads the verdict back into `verifier/outcomes.jsonl`, and `verifier.mjs score` joins it with the labels.
- **As R6 ran it.** R6's `verify.py` made the same call, with the same flags and the same small-model alias. The user turn is the product's message, which begins "Repository: <name>" as R6's did.

## Pre-registration (D10.2 and the first D10.3 check), committed before any relabel5 label or verifier reply was collected

Written and committed after the census and staging, before any labelling or verifier agent was launched. Nothing below is changed once a label is collected; a change after that is listed under Deviations with its reason.

**Population.** Every card the product shows at `de57356`: `census --all-outliers --all --max 15` per dev repo (each part's `queue.json`, the same set as `census-json/`). The tier is D7's (`eval/study/tier-d7.json`), which `stage.mjs` checks equals the census `tier` line. Language groups: **TypeScript/JavaScript** = `ts`; **Python** = `py` + `py2` pooled (each part also reported alone). Labels: `<part>/final.jsonl`, reused or fresh. An unlabelled card counts as WRONG. TRIVIAL is not ACCEPT in any metric. Intervals: Wilson 95%, with the repo-cluster bootstrap (`metrics.mjs`, `lib.mjs clusterBootstrap`) for pooled rates. Computed by `metrics.mjs` (per part, on `<part>/views/d7`) and `d10.mjs` (all of the following).

1. **Primary: per-card accept** = ACCEPT / shown, per language, for the default tier, the suggestion tier and all shown. Round-9 targets on dev: all-shown accept ≥ 60% for TS and for Python (point estimate).
2. **Default-tier accept** = ACCEPT / default-tier shown, per language (Python has no default tier under D7).
3. **Flag precision (D10.2 secondary A).** The unit is one labeller's verdict on one outlier of a shown card that lists outliers.
   - Verdicts come from the A and B records behind each final label. For a fresh label, these are this run's records. For a reused label, they are the records of the run that labelled the card, followed through carried rows. C's verdicts are not used.
   - Real violation = `mistake` or `look`. The denominator is every verdict: `mistake`, `look`, `legit`, `not_violation` and `one_off`. [STRICT] `not_violation` (the tool misread the code) and `one_off` (the definition or the one registry) are flags that are not violations, so they count against precision.
   - Reported pooled over A and B (an outlier both opened counts twice), and per labeller, per language and tier. Also reported, as a secondary reading, without `one_off`.
   - The Wilson interval treats the verdicts as independent, which they are not. The repo-cluster bootstrap is reported beside it.
   - Cards whose records cannot be traced are listed and left out. No target (PLAN-PAR).
4. **Agent-shown precision (D10.2 secondary B)** = ACCEPT / cards shown to agents, per language. The cards shown to agents are:
   - the default tier;
   - suggestion-tier cards the family table admits (census `agents.shown_to_agents`, W0);
   - suggestion-tier cards whose verifier verdict passes (item 5).

   Also reported as shipped, with `agents.verify: off`: the default tier and family-admitted suggestions only. Round-9 target on dev: ≥ 95%.
5. **Verifier (D10.3, first check).**
   - **Population.** Every shown suggestion-tier card. The default tier is never verified [STRICT].
   - **Payload.** Built by the product itself. In a scratch checkout at the pin, `drift init --max 15` runs, every shown suggestion-tier card is accepted (`drift review --accept`), `agents.verify: on` is set, and the tool is called (`drift mcp`, `drift_verify_card` with only `id`). The prompt is v3, frozen (sha256 `8298c26d…`).
   - **Samples.** 3 per card. The system prompt is v3 and the user turn is the payload's `message`. Each sample was to be one fresh agent on the session's default model, launched by the lead; this was changed before any sample ran (Deviations).
   - **Tags.** A card is **tuned** when its uid is in R6's tune split (`scratchpad/research/r6/cards.jsonl`, `split: tune`, the cards R6 developed prompts v1–v3 on) and **untuned** otherwise. A stricter subset, **R6-unseen** (in neither R6 split), is reported beside it.
   - **Decision.** The product decides: the 3 replies go back through `drift_verify_card` (`decide.sh`), which runs `Sample::parse` and `decide` (2 of 3) and caches the verdict.
   - **Bad replies.** A reply that `Sample::parse` rejects is relaunched once with the same prompt in a fresh agent (in `vrun.py`, a fresh process). If it fails again, the card is **not passed**, which is what the product does: nothing is cached, so the card is not shown.
   - **Primary.** Passed-card precision on untuned cards = ACCEPT / passed untuned cards. The target is ≥ 90%, judged on the point estimate, as D1 judges its targets. The Wilson 95% interval is reported, and so is whether its lower bound reaches 90%.
   - **Coverage.** Passed / suggestion-tier cards, for untuned cards and for all. ACCEPT kept (passed ACCEPT / ACCEPT) and the tuned and all-card rows are reported beside it.
   - **Verdict.** This is the first D10.3 check, on dev. Even when it is met, it does not turn the verifier on: D10.3 also needs a fresh held-out draw.

## Results (dev, in-sample, not held-out: no verdict)
Figures come from `d10.mjs` (`d10-metrics.{json,md}`), `metrics.mjs` (`<part>/metrics.json`, `<part>/views/d7/metrics.md`) and `verifier.mjs score` (`verifier/score.{json,md}`). Every shown card is labelled, so no card counts as WRONG for want of a label. Brackets are Wilson 95% intervals; "cl" is the repo-cluster bootstrap.

**Agreement** (A vs B on the 116 fresh cards, before adjudication):

| Part | Cards | Exact | κ (cl) |
|---|---|---|---|
| ts | 80 | 87.5% | 0.76 (0.53–0.92) |
| py | 12 | 100% | 1.00 |
| py2 | 24 | 75.0% | 0.44 (0.00–0.82) |

C adjudicated 16 cards and sided with A on 15, B on 1.

**Primary: per-card accept, D10.2** (pre-registered groups; Python = py + py2):

| Group | Default tier | Suggestion tier | All shown (target ≥ 60%) | relabel4, all shown |
|---|---|---|---|---|
| TypeScript/JavaScript (ts) | 100% (30/30) [88.6–100] | 54.7% (64/117) | **63.9%** (94/147) [55.9–71.3], cl 50.7–76.4: met | 62.6% (92/147) |
| Python (py + py2) | none | 61.0% (47/77) | **61.0%** (47/77) [49.9–71.2], cl 52.4–70.6: met | — (Python proposals only: 49.2%, 31/63) |
| py | none | 58.8% (10/17) | 58.8% | 57.1% (12/21, Python proposals) |
| py2 | none | 61.7% (37/60) | 61.7% | 45.2% (19/42, Python proposals) |

Secondary, not pre-registered, by the proposal's own language, as relabel4 reported Python: **Python proposals only, 69.0% (40/58)** [56.2–79.4], against relabel4's 49.2% (31/63). TS/JS proposals in every part: 60.8% (101/166). The py and py2 parts hold 19 TS/JS suggestion cards, which the pre-registered Python row counts.

**Default-tier accept.** TS is 100% (30/30) [88.6–100], as in relabel4. Python has no default tier (D7).

**Agent-shown precision, D10.2 secondary B** (target ≥ 95%):
- **As shipped** (`agents.verify: off`): the family table admits no suggestion, so agents see the default tier only, at 100% (30/30) [88.6–100].
- **With the verifier on**, which is the pre-registered definition (default tier + family-admitted + verifier-passed): **91.2% (114/125)** [84.9–95.0], cl 85.2–96.8, **not met**. TS is 91.9% (79/86) and Python 89.7% (35/39).

**Flag precision, D10.2 secondary A** (A and B outlier verdicts that are `mistake` or `look`, over all verdicts; every card was traced to its records):

| Group | Default tier | Suggestion tier | All shown |
|---|---|---|---|
| TS | 89.7% (261/291), cl 85.5–92.7 | 40.0% (326/816), cl 25.2–56.1 | 53.0% (587/1107), cl 40.4–65.5 |
| Python | none | 47.7% (200/419), cl 30.6–64.8 | 47.7% |
| All | 89.7% | 42.6% (526/1235) | **51.6%** (787/1526), cl 41.2–61.8 |

Suggestion-tier verdicts: `legit` 461 (TS) against `mistake` + `look` 326. Most suggestion flags are legitimate exceptions, which matches R4's finding. The reading without `one_off` barely moves (TS 53.7%). No target applies yet.

**Verifier, the D10.3 first check** (194 suggestion-tier cards, 582 samples; every sample parsed on its first attempt, all exits 0, $0.59 in all):
- **Verdicts:** 95 passed (2 or 3 of 3), 99 not passed, 0 malformed or refused.

| Set | Passed-card precision (target ≥ 90%) | Coverage (passed / cards) | ACCEPT kept |
|---|---|---|---|
| **Untuned** (not in R6's tune split), primary | **84.3% (43/51)** [72.0–91.8]: **not met**; lower bound below 90% | 51.0% (51/100) | 72.9% (43/59) |
| … TS / Python | 81.3% (26/32) / 89.5% (17/19) | 54% / 46% | |
| R6-unseen (in neither split), stricter | 84.2% (16/19) [62–94] | 67.9% (19/28) | 80.0% (16/20) |
| Tuned (R6's tune split) | 93.2% (41/44) [82–98] | 46.8% (44/94) | 78.8% (41/52) |
| All | 88.4% (84/95) [80–93] | 49.0% (95/194) | 75.7% (84/111) |

- **Untuned false passes (8):**
  - WRONG: cal.com/D-8d7d13, cal.com/D-ec4221, dub/D-e25af3, formbricks/D-3bb3c1, netbox/D-3ab42c, tasking-manager/D-4ede9c (2 of 3);
  - TRIVIAL: twenty/D-c010e4, twenty/D-8f867b.

  Three of them (cal.com D-ec4221, dub D-e25af3, formbricks D-3bb3c1) were also among R6's 5 false passes on its frozen test split: the errors are correlated, as R6 warned.
- **Verdict on dev:** the frozen prompt v3 does **not** reach 90% passed-card precision on cards it was not tuned on. Under D10.3 it stays off, and no held-out verifier check follows from this run.

## Carried labels only: what is at stake
These come from `metrics.mjs` on `<part>/views/d7` with `--labels <part>/carried.jsonl --allow-incomplete`. They are not results.

| Part | Tier | Shown | Reused (A / T / W) | Unlabelled |
|---|---|---|---|---|
| ts | Default | 30 | 15 (15 / 0 / 0) | 15 |
| ts | Suggestion | 117 | 52 (27 / 1 / 24) | 65 |
| py | Suggestion | 17 | 5 (2 / 0 / 3) | 12 |
| py2 | Suggestion | 60 | 36 (17 / 0 / 19) | 24 |

The 15 ts default-tier cards to label are 13 whose lift alone changed and 2 whose statement changed (`dub/D-345913`, `ai/D-fc5ef7`).

## Files
| Path | What |
|---|---|
| `<part>/run.json`, `queue.json`, `proposals/`, `pool/` | `prepare.mjs` output (`documenso/D-a10f62` has no structured rule there: the yaml comes from `init --max 200`, see above) |
| `census-json/<repo>.json` | `census --json --max 15`, same binary |
| `<part>/carried.jsonl` | the reused labels, with `carried_from` |
| `<part>/relabel/` | the cards to label, prompts and (later) labels |
| `<part>/views/d7/` | D7's tier as a view, and `metrics-carried-only.{md,json}` |
| `stage.json`, `batches.json`, `sources.json` | staging record per card (no labels), batches, label sources |
| `stage.mjs`, `restage.sh`, `restage-stage.sh` | relabel4's scripts with the relabel5 changes (headers) |
| `verifier.mjs`, `mcp_payloads.py`, `vrun.py`, `decide.sh`, `mcp_decide.py`, `verifier/` | the verifier check |
| `d10.mjs` | the pre-registered D10.2 metrics |

## Deviations
- **First A prompts withdrawn.** The first staging rendered A prompts that showed each card's `agents:` line, which carries the family's labelled accept rate. Every prompt and outbox of that staging (`lbx-de3ffe`) was deleted before anything was launched; no agent saw them.
  - `prompt.mjs` then learnt to drop the line, and `restage-stage.sh` re-ran the staging step on the same census.
  - That step reused 108 labels instead of 15, because before the fix every suggestion card differed by its `agents:` line.
- **Verifier samples by script, not by agents (the lead, before any sample ran).** The pre-registration had each sample run as an agent on the default model, launched by the lead. The lead changed this so that it matches R6: `vrun.py` makes headless calls with no tools on R6's frozen small model. The 582 agent prompts, outboxes and working directories were deleted unlaunched, and `verifier/cards.jsonl` is unchanged apart from their keys.
  - R6 recorded its model only as "small (Haiku-class) model, passed on the command line". The alias used here is that class's alias, and each sample's record names the model the CLI reports.
- **Collected early, then discarded (ts A supabase).** `done.sh` ran `collect.mjs` for a whole stage, so collecting one finished row also collected ts A supabase while its agent was still working (6 records).
  - The agent then reported that it had listed a file in `checked` for one record without opening it, and that it could not correct the record because its outbox was gone.
  - The collected file was moved aside unread to `<scratchpad>/relabel5/discarded/`. The prompt was re-rendered with `--force`, which replaced its index entry with a new outbox and working directory, and relaunched.
  - The fix: `collect.mjs --repo NAME` collects only that repo's prompts. It has a test and was mutation-checked, and `done.sh` now passes it.
- **Script-edited `checked`, discarded (ts A cal.com).** The agent reported 8 records, and said it had used an inline Python command to add files to `checked` in 4 of them. The output was moved aside unread, never collected. The prompt was re-rendered (new outbox and working directory) and relaunched.
- **INVALID, relaunched on the same prompt in the same empty working directory (ts A formbricks, ts B documenso).** Each output was moved aside unread, and the agent got the same prompt plus a note paraphrasing the validator's message (no labels):
  - formbricks: one record's `checked` held no other member of the role;
  - documenso: two records lacked two other members, and `packages/trpc/server/trpc.ts`, which is outside the role, did not count.
- **Double render of two launched B prompts (ts B dub, ts B twenty), reconciled.** The lead collected A for dub and twenty, then rendered and launched their B prompts (`9f4f23c0`, `49a4531d`). Seconds later, the orchestrator's `done.sh` rendered them again. `prompt.mjs` replaces an uncollected prompt, so that second render deleted the running agents' outboxes and working directories and pointed the index at new ones. The second prompts were never launched.
  - The fix restored the run's prompt files and index entries to the launched prompts and their outboxes. The second prompts and their directories were deleted and marked retired in the map, and every other index entry was checked: one entry per prompt, and every collected file matches its recorded sha256.
  - The launched agents' original working directories are gone, so their entries point at fresh empty directories (`reconciled-<key>`, `reconciled` in the index). For these two, collect.mjs's "working directory empty" check covers only the new directory.
  - From then on, only the lead renders and collects.
- **Validator bug: merged cards (round 9 D).** The "other members" bound read only the primary part of a merged card's role (`role.also` was ignored). It therefore rejected members of a sibling part, for example ralph's `serializers` files and Django-CRM's `leads/**`.
  - `lib.mjs roleFileCandidates` now takes the union over the parts. A card with any unbounded part is unbounded. The fix has a test and was mutation-checked.
  - Outputs rejected only because of this were collected again after the fix, unchanged: py2 A ralph and py B saleor came back ok. Django-CRM B and netbox A were still INVALID for files outside every part.
  - Labeller prompts were not affected: they show the census card, whose statement names every part.
- **More INVALID outputs, relaunched on the same prompt with a paraphrased note.** Each was moved aside unread:
  - ts A midday: two records list fewer than 2 opened files.
  - ts B novu: confidence not `high`/`low`, two records with no other members, and one record without the example file.
  - py2 B InvenTree: three records short of other members.
  - ts B dub: three records short of other members, and one record without the example file.
  - ts B twenty: two records with files outside the role.
  - py2 B Django-CRM: one record with a file outside the role and a config file.
  - py A netbox: one record with a template file.
- **Evidence-location help on every relaunch (the lead's decision, applied uniformly from the 13 relaunches of 2026-11-07 on).** B kept failing the other-members rule, counting config files or files outside the role. So every relaunched agent now reads a retry file after its prompt (`retry.mjs`; `<scratchpad>/relabel5/p/<key>.retry.md`), which holds:
  - the validator's own messages, by record number;
  - for every card of the prompt, failing or not, so that the list hints at nothing, up to 25 files that can hold a member of the card's role, in a fixed random order. These come from the validator's bound (`lib.mjs memberFileInfo`: tracked, non-config, within the role's parts, not the example's or the outliers' files).

  No label, output or verdict is read or shown. The 13 relaunches it applies to are B supabase, paperless-ngx, ralph, dub, twenty, novu, Django-CRM, InvenTree, documenso and Misago, and A midday, netbox and formbricks.
- **Later relaunches with retry files:** ts B cal.com (record 1 short of other members) and ts B infisical (records 3, 4, 8 short of other members).
  - infisical B also disclosed that it had searched 3 of its `checked` files with grep rather than reading them in full. The lead counts a grep of a file's content as having looked at it. The output was set aside unread in any case, because the records were short of other members, and the relaunch opens the members properly.
- **py2 B ralph, third attempt.** The second attempt (with its retry file) was INVALID again. The lead's helper (`<scratchpad>/lead/r5redo.sh`) re-ran `retry.mjs` for the new validator messages, then moved the output aside unread. The agent was relaunched with the new retry file.
- **Retry files.** Every retry file handed to a relaunched agent is copied to `relaunch/<key>.retry.md`. For a prompt relaunched more than once, this is the latest file.
- **Relaunch totals (the lead, 2026-11-08).** Every A and B set was collected in the end (ae5c128). Prompts that took more than one attempt:
  - ts B cal.com: 4 attempts, the last with a one-card-at-a-time protocol;
  - py2 B ralph: 3 attempts;
  - ts B formbricks and py B netbox: 2 attempts each.

  The relaunches listed above took 2 attempts unless stated. No output was edited. Every rejected or discarded output was moved aside unread to `<scratchpad>/relabel5/discarded/`.
- **WIP outcomes snapshot.** The lead committed a WIP snapshot of `verifier/outcomes.jsonl` (f006027, 178 of 194 lines) while `decide.sh` was still running. The final commit replaces it with the complete file, which every figure above uses.
- **py2 C Misago:** INVALID once, for a malformed `sided_with` only. It was relaunched on the same prompt with a note, and collected.
- **Python group by part.** The pre-registered Python group pools the py and py2 parts, which hold 19 TS/JS suggestion cards. The by-proposal-language row (as relabel4 reported) is added as a secondary.
- **Verifier score file renamed (2026-11-08, after the merge of #122).** `verifier.mjs score` first wrote `verifier/metrics.{json,md}`. Under a run, `metrics.json` is `metrics.mjs --json` output: the Studio's Studies view and `family-admission.mjs` read it from every directory of the run, so the Studio listed `verifier/` as unreadable (no `run` field) and `family-admission.mjs --run` on this run stopped at it (`kind undefined`). `verifier.mjs score` now writes `verifier/score.{json,md}`; it was re-run on the committed `cards.jsonl`, `outcomes.jsonl` and `<part>/final.jsonl`, and both files are byte-identical to the old ones. No figure changed.
