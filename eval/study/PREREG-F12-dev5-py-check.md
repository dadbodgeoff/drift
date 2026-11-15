# F12 freeze record and dev5 pre-registration: the Python opt-in view (decision D13-py, PLAN-R11 §3)

> The selection record, registry and saved PR text (`eval/dev5-*.json`) and the tooling this names (`select-holdout.mjs --selection dev5`, `insample-py.mjs`) are not in the tree: `git show 6d5df8d:<path>`.

This file is committed and pushed **before the F12 freeze is recorded, before the dev5 selection seed is drawn or committed**, and so before any candidate of the dev5 draw is seen, before any census of the pool and before any label of it. It names no dev5 repo: the pool's repos appear only by slot in `select-holdout.mjs verify` output, and by opaque key in the run directory `eval/study/runs/dev5-py`.

It decides one thing: whether mined **Python** proposals turn on by default. It measures nothing about TypeScript/JavaScript and gates no held-out draw.

Only the fields of §1 are filled in later, at the freeze `F12`, in one commit that is pushed **before the seed commit** (§2.4). Nothing else in this file changes after that commit. A deviation is reported in the run README, never edited in here.

**Amended before the freeze**, with §1 still empty and no seed drawn: every change to the first version of this file is listed, with its reason, in [Amendments before the freeze](#amendments-before-the-freeze) at the end. The sections below read as amended; each amended passage carries its amendment's number (A1 to A7).

## 1. The freeze F12 (the lead fills these at the freeze)

| Item | Value |
| --- | --- |
| Product commit `F12` | `5bafc43d4366f183ab0a25d780533c9bb1725077`, on the pull-request branch `claude/magical-wozniak-8c34ec`, pushed 2026-11-10 before the seed commit and never rewritten (A1) |
| Tree of `F12` | `260b5a122d4f6c341a46d3d7788db12288c1c432` |
| Binary | A release build of `git archive` of `F12`, `cargo build --release --locked -p drift-cli` in a fresh target directory with `DRIFT_BUILD_COMMIT` set to `F12`, as HELDOUT-RUNBOOK step 3 specifies (A6). Kept outside the tree by the lead as `f12/drift-f12` in the session's scratch directory; 25,863,160 bytes; its `census --json` `commit` tag is `5bafc43d4366f183ab0a25d780533c9bb1725077`. The build was interrupted once by a container restart while compiling the last crate and resumed in the same target directory. (A6) |
| Binary sha256 | `18681df2dce171063be1128a2c4fd27489456270fc26b83f3d04d12dc55580ba` |
| Toolchain | `cargo 1.97.0 (c980f4866 2026-06-30)`, `rustc 1.97.0 (2d8144b78 2026-07-07)` |
| Gates on `F12` | At `F12`: `cargo fmt --all --check` clean; `cargo clippy --all-targets --locked -- -D warnings` clean; `node --test eval/study/*.test.mjs` 301 tests, 298 pass, 0 fail, 3 skipped (they need a dev5 record); `select-holdout.mjs verify` exit 0 on a full clone. `cargo test --all --locked --no-fail-fast -- --skip worst_case_nesting`: 109 test binaries, 1,380 pass, 0 fail, run at `0d144f40`, three study-tool commits before `F12`; the `crates/` tree is the same object at both (`805abe722f14100debc5ac65d2028906955f894c`), and the run was not repeated at `F12`. |
| Show table | The product's own at `F12`. sha256 of `crates/drift-mine/data/show-policy.json`: `190f039a9aaf02d19f7c5f24d373a916717e0f708b5eac09dd52827ca59a5114`; `source.run` `eval/study/runs/dev-v3-relabel6-2026-11-10`; Python families admitted: control, layering, naming, wrapper, as expected. The table is **not regenerated** between `F12` and the dev5 report. |
| Agent admission | sha256 of `crates/drift-mine/data/family-admission.json`: `f194215633496c4afd06fb49ec2653ad47274093a150f25332bed3bc200dab2b` (it admits no Python family; unchanged by this check). |
| Versions | facts schema 11, `selector_version` 3, Python `LOWERING_VERSION` 30. |
| Tier | `eval/study/tier-d7.json`, as frozen in the dev5 manifest: Python has no default tier, every Python card is a suggestion. The census runs with `prepare.mjs --strict-tier`. |
| Rubric | v3, the text approved with D6: labeller-facing text sha256 `79316bdc08a60209a5fb4cb887ad35a4ca4131255e96da2909c2242ac4e2c1dd` (`lib.mjs` `APPROVED_RUBRIC`). Confirmed at `F12`: the constant holds that hash. |
| Python opt-in | `drift census --python-proposals` (the study's opt-in view) and `proposals: {python: on}` in `.drift/config.yaml`. Confirmed at `F12`: the frozen binary's `census --help` lists `--python-proposals`, and the in-sample run below used it. |
| **Build-set in-sample figure for bar (c)** | **83.3% per-card accept (25 ACCEPT of 30 shown); not wrong 83.3% (25/30); 0 TRIVIAL, 5 WRONG, 0 unlabelled.** `view_sha256` `d65ef377aa065d063a913d4ab5acc8dc5bc8ead54f4a261b9114d37288f94065`. By family: naming 12/14, control 5/7, layering 6/7, wrapper 2/2. By pool: the 18 build repos 10/10, dev3 5/6, dev4 10/14. Measured 2026-11-11 with the `F12` binary; no shown card was unlabelled, so none was labelled for this figure. So bar (c) asks dev5 for a per-card accept between 73.3% and 93.3%. What was measured: per-card accept (ACCEPT / shown) of the Python opt-in view at the `F12` binary over the 50 Python build-set repos (the 18 scanned repos of `eval/repos-py.json` and `eval/repos-py-2.json`, the 8 of dev3, the 24 of dev4), and beside it the not-wrong rate. **It is re-measured on the frozen binary; it is not copied from a record.** How: §6 (c), with `node eval/study/insample-py.mjs --drift <the F12 binary> --out eval/study/PREREG-F12-insample.json` (A7). The JSON is committed with this row, and its `view_sha256` is written here too (A2). |

**Reference, not the figure:** on the mined pool at `3f2bd7b3` (a debug build, before the freeze, not the frozen binary), the opt-in view under the relabel 6 table is 30 shown cards on the 50 repos, 25 ACCEPT, 0 TRIVIAL, 5 WRONG: accept and not-wrong both 83.3% (`research/2026-11-10/python12.md` §9.5).

## 2. The pool and the draw

### 2.1 Size and quotas

- **30 Python repos, no TypeScript/JavaScript set.** At the build set's 0.60 shown Python cards per repo, 30 repos show at least 10 cards 98.5% of the time (Poisson; 99% when the 50 build repos are resampled), and about 18 are expected.
- **Quotas:** Django/DRF 9, FastAPI 9, Flask 6, other Python 6. These are dev4's Python quotas (7, 7, 5, 5) scaled to 30/24 by largest remainder, ties in bucket order; they are also exactly three times the held-out quotas (3, 3, 2, 2).
- **Reserves: 48**, fixed before the draw: the held-out reserve order (Django, FastAPI, Flask, other) twelve times. That is the next whole number of rounds at or above 1.5 times the slots, dev4's ratio; dev4's Python part used 13 of its 36 for 24 slots.
- **Hand-up cap:** if a bucket cannot be filled from the whole pool, its open places go to the other buckets in bucket order, never above 15 per bucket (three times the held-out cap, as dev4's was doubled with its quotas).
- **Buckets, filters and classifier:** the held-out draw's, unchanged (stars, size, licence, push window of six months before the draw date, non-application names and topics, dependency-manifest classification).

### 2.2 Exclusions

Everything `select-holdout.mjs fetch` computes, at every ref of the Drift repository when the draw runs: every dev manifest (`eval/repos*.json`, so polar and CTFd), every held-out manifest (primary, secondary, heldout2: repos, reserves, `replaced`, `burned`, `exposed`), **every earlier blind dev pool, dev3 and dev4**, with their reserves and replaced slots, the pools committed as hashes (the apps sets), every selection record, any `github.com/<owner>/<repo>` on any branch, commit messages, and PR and issue text, read as A3 says. Only dev5's own outputs are not sources.

### 2.3 How the draw runs

`node eval/study/select-holdout.mjs fetch --selection dev5`, then `write`, the technical check, and `verify`. The tool knows the selection (its spec is committed with this file); it refuses `fetch`, `write`, `verify` and `extend` for it until it is seeded (§2.4).

What a `--selection dev5` draw needs:
- **The GitHub CLI, `gh`, authenticated** (`gh auth login`, or `GH_TOKEN` / `GITHUB_TOKEN` in the environment). Every API call is `gh api -X GET`, and only the search endpoints are used (A3):
  - `search/repositories`, for the candidates (the search API allows 30 requests a minute; the tool sleeps between pages and retries rate limits);
  - `search/code`, restricted to dependency-manifest file names, for the framework classification (code search needs an authenticated caller);
  - `search/issues`, for the exclusions that come from PR and issue text: every pull request and issue with its title and body, and one search per candidate about to take a place. The selection is pre-registered with `--discussion search`; A3 says what that is and how it differs from dev4's exclusions.
- **`git ls-remote <url> HEAD`**, with no credentials, to pin each walked candidate's commit. Nothing of a candidate is cloned.
- **Network** to `api.github.com` and `github.com`, through whatever proxy the environment sets.
- **A full clone of the Drift repository with every branch, fetched as the remote `driftv22`** (`git fetch driftv22`, HELDOUT-RUNBOOK): the exclusions read git objects at `refs/remotes/driftv22/*` and `refs/heads/main`, and `verify` checks the held-out manifests' history. A shallow clone fails `verify` ("the clone is shallow"). In a clone whose remote has another name the tool reads local `main` alone, so the operator adds the remote under that name first (A3).
- **The seed commit of §2.4**, pushed.
- **Then:** the record `eval/dev5-selection.json` and the saved PR text `eval/dev5-discussion.json` are committed (A3); `write` (the manifest `eval/dev5-py.json`, the registry `eval/dev5-registry.json`), `techcheck.mjs` on the frozen binary (rule 1: each repo clones at its pin, `drift scan` runs, at least 200 parseable files; a failing repo gives way to the next reserve in order; no extension), and `verify`. If the 48 reserves run out, the slots filled are the pool and n is reported as a deviation.

**Isolation.** Every output of the selection is named `eval/dev5*` or lives under `eval/study/runs/dev5*`. Only the dev5 operator runs the draw and the census, or opens those paths, until the report. **The dev5 operator is a fresh agent that built no product, no mechanism and no table. The lead launches the labellers and runs the tools that print aggregates (`collect.mjs`, `agree.mjs`, `adjudicate.mjs --merge`, `metrics.mjs`), and opens no dev5 card, label or reason before the report** (A5). The study tools refuse dev5 as build-set data until its report is in the tree (`lib.mjs` `BLIND_POOLS`).

### 2.4 The seed rule

The seed is `drift-dev5-<date>:<commit>:<128 bits>`: the date of the draw, the commit of the pull-request branch the selection branches from (`F12` or a later commit of that branch; A1), and 128 bits from `openssl rand -hex 16`, drawn once, before any candidate of this selection is seen. It is committed together with the draw date and `pushed_since` (six months before the date) into the dev5 spec of `select-holdout.mjs`, in one commit, the **seed commit**, pushed before `fetch` runs.

The seed commit comes **after** the commit that fills §1. In particular the in-sample figure of bar (c) is committed and pushed before the seed exists [STRICT].

## 3. The census

- **Keys.** Each repo is named by an opaque key (`P01`…) in a census manifest inside the run directory, which records the frozen manifest's sha256 and core. `max` is 15 and `pool` 200, as frozen.
- **Census.** A dev run of `prepare.mjs` on the `F12` binary, with `--python-proposals --strict-tier`, one repo at a time. `start.json` is committed and pushed before the census. The shown set is the **opt-in view**: every card `census --python-proposals --all --max 15` lists whose language is Python.
- **Also recorded:** the default census (proposals off), once per repo, for its shown-card count only (expected 0).
- **Failures.** A repo that fails census or `init` is reported as a failure, with no swap. It counts as a repo with no shown card.

## 4. Labelling

- **Rubric v3**, by the hash of §1. One run, one rubric.
- **Labellers, by role.** Two fresh labellers per repo, **A then B**, never at the same time on one repo: A runs on the session's default model; B runs on a different, smaller model, launched after A's output for that repo is collected. **C**, a fresh agent that ran neither, adjudicates the disagreements only. The lead keeps the model identifiers; no file records them.
- **Who may open what.** Labellers read the checkout and write their outbox, in a fresh empty working directory. Nobody who built product, a mechanism or the table opens a dev5 card or label before the report; the lead, who launches the labellers, opens none either (A5).
- **Collection.** `collect.mjs --complete`, with its validity rules as they stand at `F12` (README, "Label: A and B, independently"): a record must follow the rubric's schema and name the rubric its prompt was rendered with; `checked` must list the example file, min(3, outlier files) outlier files and two further files that can hold a member (config files and files outside the role do not count); an output must cover exactly its repo's cards, sit alone in its outbox, leave its working directory empty and the checkout unchanged, and not repeat another labeller's text. An output is never edited.
- **Two rerun practices are allowed in advance**, as used in `runs/py12-pool-2026-11-10` (its `DEVIATIONS.md` 2 and 3) and before it in `dev-v3-relabel3-2026-11-07`. Each use is listed in the run README:
  1. **A whole output that fails `collect.mjs`** is moved aside unread and the labeller is rerun as a **fresh agent on the same rendered prompt**, with one added sentence that restates rubric "What to open" rule 3 and the two allowed `confidence` values. The sentence names no label and no card. B may carry that sentence from its first launch.
  2. **A single record that fails the same check again** goes back to the **same agent**, with the collector's message and the role named, and the instruction to open more members, add them to `checked`, and keep or change its label only by what it reads. Nobody names a label to the agent, and the lead does not read the record's label or reason.
- **Agreement and adjudication.** `agree.mjs` before adjudication; C on disagreements only; `adjudicate.mjs --merge` writes `final.jsonl`.
- **Unlabelled.** A card without a final label counts as WRONG in every rate.

## 5. Measures

Every rate is over the shown cards of the opt-in view, unlabelled counted as WRONG, with its n, the Wilson 95% interval and both repo-cluster 95% intervals (the wider one is quoted).

1. **Shown cards**: the count, stated first, and shown cards per repo.
2. **Not wrong**: (ACCEPT + TRIVIAL) / shown.
3. **Per-card accept**: ACCEPT / shown.
4. **By family and by framework bucket**: shown, ACCEPT, TRIVIAL, WRONG.
5. **Yield**: accepted cards per repo (mean, median, repos with none). Repos with no shown card, and failed repos, count as zero.
6. **WRONG causes**: `wrong_because` of the final WRONG labels, and the number of unlabelled cards.
7. **Flag precision**: (`mistake` + `look`) / the per-outlier verdicts of the A and B records. No target.
8. **Also reported**: agreement (exact, κ where n allows, the confusion matrix), failed repos, the default census's shown count.

## 6. The dev5-py-check (PLAN-R11 §3, verbatim)

> **What brings them back:** a blind pool, measured on the opt-in view at a frozen product, with:
> - **≥ 10 shown Python cards**, and
> - not-wrong ≥ 70%, and
> - within 10 points of the build-set in-sample figure.
>
> These are D12's Python bars (b) and (c), plus a minimum n. Without the minimum, 2 lucky cards would pass. A pass turns proposals back on; a held-out pass is then needed before any Python claim.

**How each bar is judged** (point estimates; strict wherever the wording is open; the definitions are those of the dev3-check and the dev4-check):

- **(n)** The opt-in view shows **at least 10** Python cards over the pool. With fewer, the check fails whatever the rates [STRICT].
- **(b)** Not wrong, measure 2, is **≥ 70.0%**.
- **(c)** **|dev5 − build-set in-sample| ≤ 10.0 points**, where both figures are per-card accept (measure 3), over all shown cards of the opt-in view, unlabelled counted as WRONG.
  - **The in-sample figure** is the one written into §1 at the freeze: the `F12` binary's `census --json --max 15 --python-proposals` on each of the 50 build clones at its pinned sha (each clone clean before and after), with the newest build-set labels carried to cards whose labeller-facing text is byte-identical (rule 4). A card that view shows and that carries no label is labelled blind, A/B/C under rubric v3, **before the seed commit**; one still unlabelled then counts as WRONG in the figure.
  - The difference is taken both ways, as the dev4-check took it: a dev5 figure more than 10 points **above** the in-sample one fails (c) too. The bar asks whether the build set predicts a blind pool.
- **The check passes** only if (n), (b) and (c) all hold [STRICT: joint].
- Nothing else enters: no interval, no per-family figure, no reading with a card left out, no second count.

## 7. The known weakness, stated before the draw

**The table's three new Python families rest on dev4's labels, which are now in sample.**
- The relabel 6 table admits control, layering and call wrappers because the mined pools of dev3 and dev4 supplied the labelled cards the leave-one-repo-out rule needs. The same rule on the table **without dev4's repos admits naming only**; without dev3's it admits all four.
- So dev4 could not have predicted its own result, and the in-sample figure is over cards whose own labels chose the families. Its leave-one-repo-out reading is the same 30 cards (25 not wrong); its leave-one-pool-out reading is 18 cards, 16 not wrong.
- Every blind Python figure so far came in below its in-sample one (dev3 1/2 against 12/12; dev4 2/3 against 13/14). Under the relabel 6 table dev4's own cards are 10/14 not wrong (71.4%), the lowest pool and the newest.
- Bar (c) is the bar most likely to fail: it asks dev5 to be at or above about 73% accepted when the in-sample figure is about 83%.

This check is the first out-of-sample reading of the three new families. That is its purpose, and no part of the bar is softened for it.

## 8. What follows, both ways

- **On a pass:** mined Python proposals **turn on by default in the next commit on the pull-request branch** after the report, **subject to the transfer condition below** (A2, A4), and decision **D13-py is closed** in the README decision log, citing the dev5 run and this file. dev5 joins the build set. A held-out pass is still needed before any Python accuracy claim (PLAN-R11 §3).
- **On a fail:** **the default stays off.** dev5 joins the build set after its report. **Nothing in the rubric, the minimum of 10, the 70% bar, the 10-point bar, the population or the counting rules is changed after the fact**, and the check is not re-read under another definition. A later attempt needs a new freeze, a new pool and a new pre-registration.
- **Either way** the report is `eval/study/runs/dev5-py/dev5-check.md`. Its presence in the tree is what makes dev5 build-set data for the study tools.
- **The transfer condition (A2).** The verdict is about the `F12` binary. It applies to a later commit only if that commit's opt-in census (`census --json --max 15 --python-proposals`) is byte-identical to the `F12` binary's on all 50 build repos. A later commit that changes it has not been measured by this check, and the default is not turned on at such a commit.
  - How it is checked: `insample-py.mjs` on each binary, on the same clones. Its `view_sha256` is a digest of each repo's census JSON without two fields, `commit` (the build's own tag) and `root` (the clone's path), which name the build and the place and are not census output. Equal digests are what "byte-identical" means here.

## 9. What is not part of this check

- **TypeScript/JavaScript**, the candidate tier and D12: no dev5 TS/JS set is drawn, and no held-out draw is gated here.
- **Mining mechanisms.** Any Python mechanism that is to be measured by this check is merged before `F12`. One merged after it is not in the frozen binary and is not measured.
- **The show table**: frozen at `F12`. dev5's labels do not enter a table before the report.

## 10. Order

1. This file, committed and pushed.
2. The freeze: `F12` pushed on the pull-request branch (A1) and built (A6); §1 filled, with the in-sample figure re-measured on the `F12` binary by `insample-py.mjs` (A7; any unlabelled shown card it lists is labelled first), committed and pushed.
3. The seed commit (§2.4), pushed. Then the draw, the manifest, the technical check and `verify`.
4. `start.json`, committed and pushed.
5. The census (opt-in view; the default view's count).
6. A, then B.
7. Agreement.
8. C.
9. The merge.
10. `metrics.mjs`, then the dev5-py-check report.
11. §8, the transfer condition first.

**After the report: aggregates only.** No card-level content of dev5 (card ids, reasons, file names, selectors, quoted code or label text) is quoted in any plan or research document. The run directory holds the card-level record and is cited by path.

## Amendments before the freeze

Made on 2026-11-10, with §1 empty, no `F12` recorded, no seed drawn and no dev5 candidate seen. Nothing in the bar (§6), the pool size, the quotas, the rubric or the counting rules is changed. Each entry says what changed and why.

**A1. `F12` is a commit on the pull-request branch `claude/magical-wozniak-8c34ec`, not on main.**
- *Was:* "the full sha, on main" (§1); a seed naming "the main commit the selection branches from" (§2.4).
- *Now:* `F12` is a commit of that branch. It is pushed before the seed commit and is never rewritten. The seed names the commit of that branch the selection branches from.
- *Why:* the branch is under review and carries unrelated authorization and exposure work that is not ready to merge. The repository merges with merge commits, so `F12` stays reachable from main after the merge.
- *Also amended to match:* the seed comment in the dev5 spec of `select-holdout.mjs`.

**A2. The transfer condition** (§8, §1).
- *Was:* nothing. The first version turned the default on "in the next commit" without saying what that commit may contain.
- *Now:* the verdict applies to a later commit only if that commit's opt-in census (`census --json --max 15 --python-proposals`) is byte-identical to the `F12` binary's on all 50 build repos. A later commit that changes it has not been measured by this check, and the default is not turned on at such a commit.
- *How it is checked:* `eval/study/insample-py.mjs` prints `view_sha256`, a digest of each repo's census JSON without its `commit` and `root` fields. Those two name the build and the clone's path; a rebuilt binary of another commit differs in `commit` by construction. The `F12` digest is written into §1 with the in-sample figure.
- *Why:* `F12` sits on a branch that will go on moving (A1). Without the condition a pass could be claimed for a binary that shows other cards.

**A3. The exclusions that come from PR and issue text are read through the search API** (§2.2, §2.3).
- *Was:* the three list endpoints (`repos/<repo>/issues`, `issues/comments`, `pulls/comments`): every title, body, comment and review comment scanned whole for `github.com/<owner>/<repo>`, as for dev3 and dev4.
- *Why:* the environment this draw runs in serves `gh api` for `search/repositories`, `search/code` and `search/issues`, and not for those list endpoints.
- *Now:* the selection is pre-registered with `--discussion search` (`select-holdout.mjs`, `DISCUSSION`; in the dev5 spec, so `verify` checks it, and not a choice of the command line):
  1. **Titles and bodies** of every pull request and issue are fetched through `search/issues` (`repo:<the Drift repository> is:pr`, then `is:issue`; 100 a page, by creation date, until a short page). An answer GitHub marks incomplete, or a count that differs from `total_count`, stops the run. They are scanned exactly as the list pages were, with the same source label, and saved by `fetch` to `eval/dev5-discussion.json`, whose sha256 and count go into the selection record. The file holds only this repository's own pull-request and issue text. It is committed with the record.
  2. **Comments and review comments** cannot be listed. Instead, every candidate about to take a place, a primary's or a reserve's, is searched for: `repo:<the Drift repository> is:pr "<owner>/<repo>"`, and the same with `is:issue`. Any hit skips the candidate, with the reason "named in PR or issue text (search)", and the walk goes on. The two queries, their `total_count` and the numbers of the hits are recorded for every candidate searched, hit or not.
  3. **`verify` replays both offline:** the bodies from the saved file, by its recorded hash; and the walk with the recorded searches, which must be those of exactly the candidates that were about to take a place, in walk order.
- **How this differs from dev4's exclusions, plainly:**
  - *Titles and bodies:* the same. They are scanned in full, and a repository they name by URL is out of the pool before the walk.
  - *Comments:* not scanned whole. A candidate is checked through GitHub's issue search, which is equivalent **only as far as that index covers comment text**. There is one positive check, made by the lead on 2026-11-10: a word that occurs in one pull request only in a review thread, in neither its title nor its body, is found by `search/issues`. That is a single data point. A comment the index does not cover would not exclude a candidate, where dev4's scan would have.
  - *What is matched:* the candidate's `owner/repo` as a phrase, where the scan matches `github.com/<owner>/<repo>`. The phrase also matches a mention without the host. One check, 2026-11-10: a dev repository's `owner/repo`, searched this way, returns seven pull requests. That a URL inside a comment matches the phrase was not tested separately.
  - *When:* a repository named only in a comment stays in the eligible pool and is skipped in the walk, where dev4's scan removed it from the pool. The pool count differs; the repos that take places do not, as far as the index is complete.
  - *Who is searched:* only candidates about to take a place (78 places, and one more search for each skip), because search allows 30 requests a minute. A candidate whose bucket is already full is not searched and takes no place.
  - *Replacements:* a slot that fails the technical check is filled from the reserves, in order. Every reserve was searched at the draw; none is searched again at the swap.
- *Measured by the lead on 2026-11-10, for reference:* `is:pr` returns 191 pull requests in two pages (100 and 91) with `incomplete_results: false`; `is:issue` returns none.
- *Unchanged, and stated because this environment's clone names its remote `origin`:* the git part of the exclusions reads `refs/remotes/driftv22/*` and `refs/heads/main`. The operator adds the Drift repository as the remote `driftv22` and fetches it before `fetch` (HELDOUT-RUNBOOK, the dev3 and dev4 sections). Without it only local `main` is read.

**A4. On a pass** (§8).
- *Was:* "turn on by default in the next commit after the report".
- *Now:* in the next commit on the pull-request branch, subject to the transfer condition (A2).
- *Why:* A1 and A2.

**A5. Who is who** (§2.3, §4).
- *Was:* "only the dev5 operator runs the draw, the census and the labelling".
- *Now:* the dev5 operator is a fresh agent that built no product, no mechanism and no table; it runs the draw and the census. The lead launches the labellers and runs the tools that print aggregates, and opens no dev5 card, label or reason before the report.
- *Why:* this is how the run is staffed. The lead built the product and decides on the result, so the lead's own blindness is stated and not assumed.

**A6. The frozen binary** (§1).
- *Was:* "a release build of a clean worktree at `F12` (`build-verified.sh`; the build tag check must pass)". That script is not in this repository; it was a script outside the tree in earlier rounds.
- *Now:* what HELDOUT-RUNBOOK step 3 specifies and the tools can check: a release build with `cargo build --release --locked`, from `git archive` of `F12`, in a fresh target directory. The record (§1) holds the commit, the tree, the binary's sha256 and its `census --json` `commit` tag.
- *`prepare.mjs` does not build it for this run.* It builds the product itself only for a held-out manifest (`buildProduct`, with `--drift-src`). dev5's manifest has role `dev`: a dev run takes a built binary with `--drift` and records the commit it is told. So the lead builds by hand, with the same steps `prepare.mjs` runs for a held-out run, and the tag set:

  ```sh
  F12=<the full sha>
  B=<a new directory outside every checkout>
  mkdir -p "$B/src" && git archive --format=tar "$F12" | tar -x -C "$B/src"
  (cd "$B/src" && CARGO_TARGET_DIR="$B/target" DRIFT_BUILD_COMMIT="$F12" cargo build --release --locked --bin drift)
  cp "$B/target/release/drift" "$B/drift-f12"
  git rev-parse "$F12^{tree}"                                  # the tree
  sha256sum "$B/drift-f12"                                     # the binary's sha256
  "$B/drift-f12" census --json --max 1 --root "$B/src" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).commit'   # must print $F12
  (cd "$B/src" && cargo --version && rustc -vV)                # the toolchain
  ```

  The census of §3 then names that binary and that commit: `node eval/study/prepare.mjs --drift "$B/drift-f12" --drift-commit "$F12" --manifest <the census manifest> --run eval/study/runs/dev5-py --python-proposals --strict-tier`. `run.json` records the binary's sha256, which must be the one in §1.
- *Why:* a freeze record should name only steps a reader can find in the tree and repeat.

**A7. The in-sample figure has a script** (§1, §6 (c), §10).
- *Was:* §6 (c) described the measurement; no tool was named.
- *Now:* `node eval/study/insample-py.mjs --drift <the F12 binary> --out eval/study/PREREG-F12-insample.json`. It checks each of the 50 clones is at its pin and clean before and after, runs the census with `--no-cache` and a cache directory outside the clone, carries the labels of the run the show table was made from to cards whose labeller-facing text is byte-identical (rule 4), and prints the shown cards, ACCEPT / TRIVIAL / WRONG / unlabelled, per-card accept and not wrong with n, by family and by pool, and the unlabelled shown cards by repo key and card id. Those are labelled before the seed commit, as §6 (c) already says. The JSON is committed with §1.
- *Why:* the figure is one side of bar (c); it should come from a command, not from a hand count.
