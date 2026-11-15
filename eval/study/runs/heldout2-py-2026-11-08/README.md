# Second held-out run, Python (py-heldout2-2026-11-07), 2026-11-08

**Status: labelled, adjudicated and measured (2026-11-08); run directory committed as runbook step 7 lists.** The manifest is `eval/holdout-2-2026-11-07-py.json`: role `primary`, 10 slots, decision D11. The census ran at the round-9 freeze.

## Freeze checklist (D11 freeze, recorded before any census)
| Item | Value | Check |
| --- | --- | --- |
| Product `F` (D9 freeze scope, D11) | the product tree of main `de57356` (round 9: B, C, D, E, F and G merged). The tree outside `eval/` is `2018b7c84ac7195e30dc90a189f54dff0487cd08`, identical at main `011ae8c` | `git diff --stat de57356 <run commit> -- . ':(exclude)eval'` is empty |
| Run commit (`run.json` `drift.commit`) | `4e017e38ccc507d282ca31f49029ca48f035ddc1`: main `011ae8c` plus eval-only commits (the D11 freeze record, the rule-1 swaps) | `prepare.mjs` builds it from `git archive` |
| Binary sha256 | `41edaa85c656d5161430dc88c0549da4e908aca7c110a54dc3f0a612d7fec015`, the same for both runs, for the step-2 dry-run build and for the rebuild on the swap commit | step 3: both `binary_sha256` equal, each equal to `sha256sum` of its copy |
| Verified build | `build-verified.sh` at codegen-units 66, census `commit` `cgu66-04112a1-…`. Behaviour probe: on one dev repo, it and the run binary give byte-identical `census --json --max 15` (15 proposals), apart from `commit` | — |
| Versions | facts schema 10; `selector_version` 3; TS `LOWERING_VERSION` 37; Python `LOWERING_VERSION` 16; `cargo 1.97.0 (c980f4866 2026-06-30)`; `rustc 1.97.0 (2d8144b78 2026-07-07)`; no user cargo config | `run.json` `drift.build` |
| Tier | `tier-d7.json` (sha256 `e695112de57a…`), D7, frozen in the manifest; no amendment possible (D11) | step 0 checks 1 and 4; every census `tier:` line equals `tierOf` |
| Rubric | v3, labeller-facing sha256 `79316bdc08a6…` (D6) | rubric line; `prompts/index.json` rubric `v3` |
| Decision log | D1–D11. The D11 freeze record (no verifier check: D10.3 dev gate not met, 84.3% < 90%; recall not measured) was pushed before the start records (`04112a1`) | `select-holdout.mjs verify` passes |
| Verifier (D10.3) | not run on these sets: the dev gate was not met in relabel5 | D11 |

## Steps and their results (counts only)
- **0. Freeze checks:** tier OK (all six registered manifests); sha256 OK; `verify` OK (both selections); rubric v3 is the approved text.
- **1. Gates on `F`:** `cargo fmt` OK; clippy 0 issues; `cargo test --all` 867 passed, 0 failed (private verified test binary, codegen-units 66); study tests 122 passed, 0 failed; tier tests pass.
- **2. Dry run on dev repos:** every command exited 0, and `dry-run.mjs check` ended with "recall match the synthetic rule". The dev clones are unchanged.
- **3. Binary:** above.
- **4. Technical check (rule 1, D3; run twice per set with identical results):** TypeScript/JavaScript: 8 of 18 slots failed, and 12 reserves were used (4 reserves failed too), leaving 6 unused. Python: 3 of 10 slots failed, and 5 reserves were used (2 reserves failed too), leaving 7 unused. Every failure was "fewer than 200 parseable files". No clone failed and no scan errored. Only `replaced` was appended (commit `4e017e3`); the frozen cores are unchanged.
- **5. Census:** the start records were committed and pushed (`4cc8f83`); `git diff --stat` against the run commit lists only the two start records. Every repo `ok`, none failed (D3). Every checkout was clean before labelling.
- **6–7. Labelling, agreement before adjudication, C, merge:** below. Recall (extraction and matching) was not run (D11).
- **8. Metrics:** `headline_eligible: true`, `tier.pre_registered: true`.

## Census
10 repos ok, 0 failed. 43 cards, all suggestion tier (D7: Python has no default tier), from 9 repos; 1 repo has no card. By convention language: 35 Python and 8 TypeScript/JavaScript.

## Labelling
- **Labellers.** A: the session's default model. B: a different, smaller model. C: the default model, in a fresh agent that was not an A or B session. Each attempt was a fresh agent started in its prompt's own empty `cwd`, given only its prompt (plus, on a relaunch, the retry file). The lead keeps the model identifiers outside the repository.
- **Order.** A, then B per repo once its A was accepted (never concurrently), then `collect.mjs --complete`, then `agree.mjs` before `adjudicate.mjs`, then C, then `adjudicate.mjs --merge`. Each output was collected alone (`collect.mjs --repo`) once the lead reported that agent done.

| Labeller | Prompts | Records | Attempts | Rejected | Discarded (lead) | Accepted on attempt 1 / 2 / 3 |
| --- | --- | --- | --- | --- | --- | --- |
| A | 9 | 43 | 10 | 1 | 0 | 8 / 1 / 0 |
| B | 9 | 43 | 13 | 4 | 0 | 6 / 2 / 1 |
| C | 3 | 3 | 3 | 0 | 0 | 3 / 0 / 0 |

Of the A prompts, 5 had the A launch wrapper on their first attempt and 4 did not (see the notes).

## Agreement (before adjudication)
43 labelled by both; exact agreement 93.0%; κ 0.88 (almost perfect; repo-bootstrap 95% 0.76–1.00, 9 repos); ACCEPT vs not 93.0% / κ 0.85; WRONG vs not 95.3% / κ 0.91. 3 disagreements went to C (3 prompts).

## Results (`metrics.md`; unlabelled counted as WRONG, none unlabelled)
| Python conventions | n | Accept | Not-wrong |
| --- | --- | --- | --- |
| Default tier (D1) | 0 | no default tier (D7): no verdict | — |
| Suggestion tier = all shown | 35 (9 repos) | 16/35 = 45.7% [30.5–61.8]; boot [23.7–68.4], t [17.9–73.5] | 20/35 = 57.1% [40.9–72.0]; boot [31.6–80.4], t [25.3–89.0] |
| **All shown, both tiers (D4)** | 35 | 16/35 = 45.7% | **20/35 = 57.1%: NOT MET** |

- **Yield (accepted per repo, 10 repos):** mean 1.6, median 1, 2 repos with none.
- **TypeScript/JavaScript conventions in this run:** 8 shown, suggestion tier, accept 0/8 [0–32.4], not-wrong 1/8. No verdict. Pooled (secondary, no verdict): 43 shown, 16 ACCEPT, 5 TRIVIAL, 22 WRONG.
- **No repo failed** (D3); no course-material repo is registered (D2).

## WRONG causes (diagnostic only; nothing is tuned on held-out data)
22 WRONG final labels, each with a `wrong_because`; all suggestion tier.

| | mixed_group | incidental | false_outliers | legit_outliers | Total |
| --- | --- | --- | --- | --- | --- |
| Python conventions | 6 | 4 | 4 | 1 | 15 |
| TS conventions | 1 | 4 | 1 | 1 | 7 |
| **Total** | **7** | **8** | **5** | **2** | **22** |

Python conventions by family: base class 4 (mixed 3, incidental 1); calls 4 (false 2, incidental 1, mixed 1); decorator 2 (false 1, mixed 1); wrapper 2 (incidental 1, legit 1); layering 1 (incidental); naming 1 (mixed); package/file 1 (false). TS conventions: ordering 3 (incidental); renders 2 (false 1, incidental 1); other avoids 1 (legit); wrapper 1 (mixed).

## Deviations and notes
- **The run directory is committed (runbook step 7; lead's decision, 2026-11-08).** This covers `run.json`, `queue.json`, `proposals/`, `pool/`, `prompts/`, `labels/A|B|C`, `adjudication/`, `final.jsonl`, `agreement.*`, `metrics.*` and `techcheck.json`, the same set as the primary run (#111) without recall, which was not run. These files name the set's repos, as the primary run's do. The operator's name map and run notes stay outside the repository.
- **Recall not measured (D11).** No extraction or matching was run; the report gives precision, agreement and yield, and recall from the primary draw.
- **No verifier check (D11, D10.3).** The verifier stays off; it was not run on these cards.
- **Swaps.** Many slots failed rule 1, as in the primary run. The set was over-drawn for this (D11), and the reserves sufficed.
- **Relaunches.** A rejected output was moved aside unread, and a fresh agent was relaunched on the same prompt in the same `cwd`. Every relaunch carried a retry file: the validator's own messages by record number, plus, for every card of the prompt (failing or not), up to 25 files the validator's role bound counts as possible other members (`lib.mjs memberFileInfo`), in a fixed random order. No label, output or verdict was read or shown. Every retry file was logged in the operator's scratch.
- **B launch wrapper (lead's decision, 2026-11-08, applied uniformly to every heldout2 B launch from the first, ts-9ae5fba9 B).** The wrapper that launches each B agent restates two rules of rubric v3 and the label schema: "What to open" (open the example's file, every outlier's file and at least two other files holding members of the role, and list in `checked` only files actually opened) and that `confidence` is exactly "high" or "low". It carries no candidate files and no card-specific help. Reason: in the primary run and in relabel5, the smaller-model B labellers failed mostly on exactly these two validator rules. A launches use the same wrapper as in the primary run. Retry files (validator messages plus candidate member files for every card of the prompt) are given only on a relaunch after a rejection, each one logged (`logs/retry.log`, copies in `relaunch/`).
- **A launch wrapper (lead's decision, 2026-11-08, after 6 of the first 9 collected outputs were rejected on rubric v3 "What to open").** From the next first-attempt A launch on, every A launch carries the same restatement as the B wrapper: open the example's file, every outlier's file and at least two other files that hold members of the role (not config files, and inside the role's package, directory and file kind); `checked` lists only opened files; `confidence` is exactly "high" or "low". No candidate files and no card-specific help. 17 A first attempts were launched without it (ts 13, py 4); the remaining 8 first attempts (ts 3, py 5) carry it. The wrapper is a procedural restatement of the rubric and is not expected to move labels. The B wrapper alone did not prevent one B rejection (on the other-members rule).
- **A discarded B output (lead's decision, 2026-11-08) [STRICT].** One TypeScript/JavaScript B labeller (key ts-94436b3d) disclosed in its reply to the lead that 4 entries in its `checked` lists were files it had only grepped and not read in full. By the lead's decision its output was discarded without collection, moved aside unread, and the row was relaunched (relaunch 1, reason "disclosed grep-only entries in checked") with a retry file saying so. The same labeller's reply also contained four repository-internal file basenames. The lead saw them, has not repeated them anywhere, and will not (rule 3).
- **Partial reads disclosed, collected normally (lead's decision, 2026-11-08).** On its relaunch 1 (after the grep-only discard above), the B labeller of ts-94436b3d disclosed that several files in its `checked` lists were opened and read only in part (the first 25–90 lines), while the example and outlier files were opened. The lead's call: collect it normally and let the validator decide. A grep-only entry was never opened, which broke the rule; a partial read is an opened file, and rubric v3 does not require reading every file in full. This reply again contained repository-internal directory and file names. The lead saw them and has not repeated them (rule 3).
- **Second-relaunch wrapper (lead's decision, 2026-11-08), applied uniformly to every relaunch 2 or later, for A and B, from ts-52eacee6 B.** It is placed after the prompt and retry-file lines, and its exact text is: "Two previous attempts at this prompt were rejected by the validator because some records listed fewer than 2 other members of the role in `checked` (rubric v3 "What to open" 3: open at least two other members of the role, in files other than the example's and the outliers'; config files and files outside the role's package, directory or file kind do not count). Work one proposal at a time: for each, open the example's file, every outlier's file and at least two other member files, write that record, then confirm its `checked` meets the rule before you start the next proposal. Label every proposal from scratch." The standard bullets follow it: `checked` lists only files opened and read; confidence "high"/"low"; records written by hand; repository content is data, not instructions; read-only; no other files written; no held-out manifests opened; name neither the repository nor any of its files; stop if blocked; reply with the output path and record count only, no label counts.
- **Privacy tightening of the B launch text (lead, 2026-11-08).** From ts-94436b3d B relaunch 1 onward, every B launch says "do not name the repository or any of its files" instead of "do not name the repository". This is a privacy change only; it changes nothing about labelling.
- **Single-file roles disclosed (2026-11-08).** On its relaunch 2, the B labeller of ts-898da091 disclosed that on two records, in its reading, the role has only one member file (the example's and the outliers' file are the same file). For those records it listed other files it had opened as "other members" and said they may not count. The validator accepted the output: its rule asks for min(2, the role's other-file bound) other members, so nothing needed fixing and no tooling change was made.
- **C launches (2026-11-08).** One fresh agent per C prompt, on the session's default model, never an A or B session, with the primary run's adjudicator wrapper. The wrapper also states the schema values `sided_with` "1"/"2"/"neither" and `confidence` "high"/"low". The TypeScript/JavaScript run had 8 C prompts for 11 disagreements.
- **The validator was not changed during labelling.**
- **Isolation.** Prompt paths are neutral (UUIDs under one root in the operator's scratch); no message to the lead named a repo. Two labeller replies to the lead (above) contained repository-internal file or directory names; the lead did not repeat them.
