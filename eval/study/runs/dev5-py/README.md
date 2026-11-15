# dev5 blind dev pool (Python): the draw, the census at F12 and blind labelling

> **Kept in the tree:** this README, the report (`dev5-check.md`), `metrics.md`, `agreement.md`, `adjudication/queue.json`, the final labels (`final.jsonl`), `default-view.json`, `start.json` and `manifest.json`. The pool, proposals, prompts, A/B/C labels, queues, `metrics.json` and `run.json`, the selection record (`eval/dev5-*.json`) and the selection and in-sample tooling (`select-holdout.mjs --selection dev5`, `insample-py.mjs`) are at `git show 6d5df8d:<path>`.

This is the dev5 run of PLAN-R11 §3 (decision D13-py), pre-registered in [`../../PREREG-F12-dev5-py-check.md`](../../PREREG-F12-dev5-py-check.md). Repos are named only by opaque key ([`manifest.json`](manifest.json)). Only the dev5 operator opens this directory, `eval/dev5*` or the pool's checkouts before the report; the operator built no part of the product, its mining or its show table.

## Freeze

- `F12` = `5bafc43d4366f183ab0a25d780533c9bb1725077`. The binary is `f12/drift-f12` in the session's scratch directory, sha256 `18681df2dce171063be1128a2c4fd27489456270fc26b83f3d04d12dc55580ba`, as recorded in the pre-registration §1. The operator checked the sha256 before first use and built nothing.
- The tooling is the seed commit `0a65c43d` of the pull-request branch plus this run's records (branch `dev5-operator`). `run.json` `harness.commit` records the commit the census ran with.
- [`start.json`](start.json) is committed and pushed before the census.

## The draw (2026-11-11)

- **Seed commit** `0a65c43d`, pushed before `fetch` ran. The spec `select-holdout.mjs spec --selection dev5` printed is the pre-registered one: 30 Python repos (Django/DRF 9, FastAPI 9, Flask 6, other Python 6), 48 reserves, `max_per_bucket` 15, pushed since 2026-05-11, `discussion` mode `search`.
- **`fetch --selection dev5`**, once, 2026-11-11T00:15:22Z to 01:32Z. Exclusions at 206 refs (`git fetch driftv22` first): 424 owner/repo, 377 name and 116 hashed entries. Pull-request and issue text through `search/issues` (A3): 191 pull requests, no issue, saved as `eval/dev5-discussion.json`.
- **Python:** 5,187 results, 3,642 eligible, 780 walked. All 30 primaries and all 48 reserves were filled; no bucket was short. 79 candidates were searched for in PR and issue text; one was skipped by a hit. 729 API calls.
- **`write --selection dev5`:** `eval/dev5-py.json` (`py-dev5`), core `3be7bf10d7619b770b128521c52f51bc03416c95ffb2522eaa3ffa8dc12a151c`, and `eval/dev5-registry.json`.

## Technical check (rule 1), 2026-11-11

`techcheck.mjs --prune --min-free-gb 3` with the frozen binary.

- **19 of the 30 primaries pass.** Every failure is "fewer than 200 parseable files": 11 primaries and 4 of the reserves that replaced them. No clone failed and no scan errored.
- **15 swaps, the first 15 reserves, in order**, appended to `replaced` unchanged. 33 reserves are left; there was no extension.
- **Runs.** The first run checked 11 reserves and asked for more; it was rerun with `--reserves 13` and then `--reserves 15`, as the tool asked. Every failure reproduced with the same count in all three runs. A fourth run on the committed manifest: 30 of 30 pass, exit 0.
- **Every slot is filled: n = 30.** By bucket after the swaps: Django/DRF 10, FastAPI 9, Flask 7, other Python 4. Rule 1 swaps in reserve order, not by bucket, so the buckets moved from the quotas.
- **`verify`:** `select-holdout.mjs verify --selection dev5` and plain `verify` both exit 0.

## Census

Run once, 2026-11-11T02:29Z to 02:34Z, after the start record was pushed (the pull-request branch at `2a8cce61` holds `start.json`, `manifest.json` and `eval/dev5-py.json` byte for byte as committed here). `prepare.mjs --python-proposals --strict-tier --only <key>` on the `F12` binary, one key at a time in key order, each key once; then the default census (`census --json --max 15`, proposals off) once per key, of which only the counts were kept ([`default-view.json`](default-view.json)).

- **30 of 30 repos ok; no failure.** `run.json`: binary sha256 `18681df2…`, commit `F12`, `max` 15, `pool` 200, `python_proposals` true, harness commit `b57a1f91`.
- **Opt-in view: 11 shown Python cards, from 10 of the 30 repos** (0.37 per repo), all suggestions. Per key: P02 1, P03 1, P06 1, P09 2, P10 1, P12 1, P18 1, P22 1, P26 1, P27 1; the other 20 keys 0.
- **Default view: 2 shown cards, both in P10, neither Python;** 0 in the other 29 keys. No Python card is shown with proposals off.
- **The queue holds 13 cards, not 11.** P10's two default-view cards are not Python (`lib.mjs` `proposalLanguage`) and the opt-in census lists them too, so `prepare.mjs` queued them and P10's label prompt holds 3 cards. The shown set of the pre-registration §3 is the 11 Python cards; nothing was removed from the queue by hand.
- **P10's deeper census lists fewer cards than its shown census** (`run.json`: `proposals` 3, `pool` 2). In every other key the two counts are equal. Recorded as a count; not looked into.
- **Checkouts.** Each key's checkout is `<cache>/repos/<key>` (`run.json` `params.checkouts`), at its pin and clean after the census and after the default census; 3.9 GB in all. They stay on disk for the labellers.
- **Labeller A's prompts** (rubric v3, the approved text `79316bdc…`): 10 prompts, one per repo with a card, 13 records expected ([`prompts/index.json`](prompts/index.json)).

Before the start record was committed, `prepare.mjs` was run once with `--only none` into a throwaway directory outside the tree: it selects no repo, clones nothing and runs no census, and it accepted this manifest, the binary and the flags (role `dev`, `max` 15, `pool` 200, 30 keys).

## Labelling and the report (2026-11-11)

- **Labellers, by role.** A: one fresh agent per repo with a card, on the session's default model. B: one fresh agent
  per repo on a different, smaller model, launched after every A output was collected. C: one fresh agent that ran
  neither, for the one disagreement. Each worked from its own empty directory with only its prompt, the checkout and
  its outbox. Their replies to the lead carried a record count and no label. No model identifier is in any file.
- **B's wrapper carried the restated rule from its first launch** (pre-registration §4, rerun practice 1): one sentence
  restating rubric "What to open" rule 3 and the two allowed `confidence` values. A's did not.
- **Collection.** `collect.mjs --complete` accepted all 10 A outputs and all 10 B outputs at the first attempt; no
  output was rejected, rerun or sent back. `agree.mjs` before adjudication: 13 cards, 12 agree. `adjudicate.mjs`: one
  card to C; `adjudicate.mjs --merge`: 13 final labels (C sided with A).
- **Who ran what.** The operator ran the draw, the technical check, the census and rendered A's prompts. The lead
  launched the labellers and ran `collect.mjs`, `prompt.mjs` (B and C), `agree.mjs`, `adjudicate.mjs` and `metrics.mjs`
  from this worktree, read their aggregate output, and opened no card, reason or checkout.
- **The report:** [`dev5-check.md`](dev5-check.md). The check passes.
- **After the report.** Python proposals were turned on by default in the commit "Python proposals on by default: the
  dev5-py-check passed (D13-py closed)", whose opt-in census on the 50 build repos has the frozen binary's
  `view_sha256` (transfer condition A2). Between the report and that commit the branch took study-test updates and
  exposure fixes whose census was checked the same way, so it was not literally the next commit (§8). D13-py is closed
  in the root README and the release notes' decisions table; the study README's decision log (D1 to D11, mirrored in
  `lib.mjs`) has no D12 or D13 entry and was left as it is.

## Note for the apps13 operator (aggregate only)

After the draw, the public check of the hashed apps13 pool (`node eval/study/select-apps13.mjs verify`) reports "1 rows are of an organisation of another pool": one repository of the dev5 manifest (an occupant or a reserve) has the same owner as a row of that hashed pool. dev5's pre-registered exclusions are by repository and by name, not by owner, so this is no deviation of the dev5 draw. It is recorded here, as the lead reported it, for the apps13 operator, who has to strike that row before apps13 runs.

## Deviations

- **Two `gh` calls outside the selection tool, before the draw (2026-11-11).** To check that `gh` was authenticated, the operator ran one `search/repositories` query that names no candidate filter of the draw and printed its `total_count` only, and one `rate_limit` query, which is not a search endpoint (§2.3 says only the search endpoints are used). Neither returned a repository name to the operator and neither is an input of the draw.
- **A selection-record summary printed exclusion entries.** While reading counts from `eval/dev5-selection.json`, the operator's summary command printed the first keys of the record's exclusion lists (repos the Drift repository already names, which are excluded from the pool). No primary or reserve of dev5 was printed.
- **The checkouts were made by the operator's driver, not by `prepare.mjs`.** Before each key's census the driver checked the free disk and checked the key out at its pin with the commands `prepare.mjs` itself runs (`git init`, `git fetch --depth 1 <url> <sha>`, `git checkout --force <sha>`), so that a network failure could be retried without becoming a census failure. `prepare.mjs` then found each checkout at its pin and clean. No fetch needed a retry.
- **A scan printed two short fragments of census text.** After the census the operator searched the run directory for model names and printed the matching fragments: two were pieces of a repository's own text in the census output (an identifier and part of a path, under 20 characters each). The operator labels nothing and passed neither on. The matches are the repository's own content, not a model identifier.
- **No opt-in census JSON is kept.** dev4's run kept a `census-json` directory; the pre-registration of dev5 does not ask for one and none was made. The checkouts and the binary are still in place.
