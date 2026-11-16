# Replay: how often Drift is right about new code

Scoreboard number 3 of `docs/v2/ROADMAP-MAP-TO-ENFORCEMENT.md` (sprint 2, step 6): the share of reports on **new code** that are true, per kind of rule, on real history. A rule kind under 80% true is quiet by default; under 90% it may not block.

`replay.py` (Python 3, standard library only; run it with `python3 -I`) does the mechanical part. People do the labelling ([LABELLING.md](LABELLING.md)).

## The method, in plain words

1. **Pick a past moment.** Take a repository with history. Go back N commits along the main line (first parent) to the *base*.
2. **Adopt Drift there, as a team would.** At the base, run `drift init`, then accept rules with the tool's own non-interactive commands: `drift review --accept <ids>` for mined proposals, and, for each practice `drift practices promote --list --json` offers, the exact `drift practices promote <P-id> --in <place>` it prints. Nothing is blocked and nothing is forced. The resulting `.drift/conventions.yaml` and `drift.lock` are the *base policy*. `run.json` records what was proposed, what was accepted, each rule's kind, tier and how it was proposed (mined, promoted practice, promoted hidden card, or whatever provenance field a newer build writes).
3. **Walk forward through what the team really did.** For each of the next M first-parent changes that touch a file Drift reads (TypeScript, JavaScript, Python, `package.json`, `pyproject.toml`):
   - make two commits in the bare clone: the change's parent plus the base policy, and the change plus the base policy on top of it. The diff between them is exactly the team's change; the policy is the one committed at the base. This is how a team that adopted Drift at the base would have met this change in CI. No `.drift/` state from a later commit is ever used: the policy is the base's, the fact cache is never kept (`--no-cache`), and the work tree is cleaned (`git clean -ffdx`) before every checkout;
   - run `drift check --diff-base <parent'> --format json` and `drift security --diff-base <parent'> --json`, one process at a time, under `nice -n 19` and a timeout;
   - record every reported line: rule family (`mined`, `practice`, `layering`, `wiring`, `security`), rule kind, how it was proposed, convention id, file, line, unit, message, and where the unit stands in the change (`new`: the change added the declaration; `edited`: the change edited lines inside it; `untouched`: reported because of a change elsewhere), plus the next later commit on the main line that changed the unit's lines (followed forward through later diffs). Legacy violations (`drift.lock`) are counted per change (`legacy` in `changes.jsonl`) but not recorded as rows, since they are the same every change; `drift-ignore`d, unsure and neighbour-held violations are recorded with `reported: false`.
4. **Sample and label.** `sample` draws up to 30 reports per rule kind on new or edited units, deterministically (hash of a seed and the report id), shuffled across kinds, each with the unit's code at that commit. Labellers mark each `true`, `public` (departs on purpose) or `misread`. They never see which build produced a report: build identity goes to a separate key file.
5. **Score.** `score` gives per kind: reports, labelled, true, public, misread, unsure, the true share with a 95% Wilson interval, and which kinds fall under 80% and 90%.

To compare two builds, run both over the same plan into two output directories and pass both to `sample --runs a b`: an identical report (same commit, file, line and text) is labelled once, and the key file maps each item back to every run that produced it.

## Biases and what it does not measure

- **Accepting everything at the base overstates what a team would accept.** `--accept all` accepts every proposal and promotes every practice candidate; a real team rejects some, so the measured reports include rules nobody would have kept. Labels still judge each report on its own, so this inflates the count of reports more than it biases the share, but rules a team would have rejected are likely to be the less true ones. `--accept default` (default tier and practices) and `--accept none` (security notices only) bound it.
- **First parent only.** A merged pull request is one change (its whole diff against the main line); commits inside a branch are not replayed. Squash-merge repositories and merge repositories therefore give changes of different sizes. Pull requests that were closed unmerged, or reworked in review before merging, are not seen at all: the replay sees what landed, not what an author first pushed, so it likely *understates* how often Drift would have spoken during review.
- **One policy for the whole window.** The policy stays the base's; a team would re-run `drift init` and review again as the code grows. Rules learned later are not measured, and a rule that went stale over the window still reports. Keep windows short (30 to 60 changes).
- **Changes Drift cannot parse.** Files Drift could not read are counted per change (`not_checked`), never reported; a change in a language Drift does not read is skipped at plan time (`skipped_no_source`). Neither is in any denominator.
- **Unit extent is approximate.** The harness finds the unit's lines from `drift facts` (a declaration runs to the line before the next one, plus decorators and comments directly above). A reported line that is not a declaration `drift facts` records (an inline Express route, say) counts as a one-line unit. This only decides `unit_age` and the excerpt; Drift's own diff filter decides what is reported.
- **"Touched later" is weak evidence.** A unit the team changed later may have been fixed, or merely edited. It is shown to labellers as context and is never a label.
- **Shallow history.** The clones are partial (`--filter=blob:none`) and bounded (`--depth 300`), so the oldest commits have no parents and cannot be a base or a change. `drift practices promote --block` still refuses these clones as shallow (`crates/drift-cli/src/promote.rs` `first_added`); the replay never asks for block mode.
- **The sample repositories are not a random draw** (two are deliberately vulnerable training apps, where many "departures" are on purpose). Report per repository as well as pooled.

## What could and could not be scripted (binary before the sprint 1 change)

- `drift init --max <N> [--all]` is non-interactive.
- `drift review --accept <ids>` accepts mined proposals without a terminal. If it ever exits non-zero, `run` falls back to setting `status: accepted` in each named block of `.drift/conventions.yaml` the way `drift review` writes it, and records `hand_written_status: true` in `run.json`.
- `drift practices promote --list --json` prints each candidate with its exact command; `run` runs those commands. Forced candidates are skipped unless `--accept` includes `forced`.
- `drift check --diff-base <ref>` needs the merge base in local history and treats an uncommitted `.drift/` as a policy change (which would turn diff mode into a full report). That is why the base policy is committed into both synthetic commits; `changes.jsonl` records `policy_changed` for every change, and it should always be `false`.
- `drift security --diff-base <ref> --json` prints the regressions (`added_without_guard`, `unguarded_reaching`, `guard_gaps`, `sinks`, `leaks`, `now_public`; `guard_unknown` is counted, never reported).

## Files

| file | what |
|---|---|
| `<plan>.json` | base, tip, the changes in order (sha, parent, subject, source files) |
| `<out>/run.json` | binary path, sha256 and version; the base setup (every command, its exit, what was accepted); reports by kind |
| `<out>/base-policy/` | the `.drift/conventions.yaml` and `drift.lock` used for every change |
| `<out>/changes.jsonl` | per change: exit codes, seconds, the `diff` summary (`policy_changed` must be false), reports, reports on new code, disk |
| `<out>/reports.jsonl` | every reported (and recorded unreported) line |
| `<out>/raw/` | the raw JSON of each `drift check` and `drift security` run |
| `<sample>.jsonl`, `<sample>.jsonl.key.jsonl` | the labeller's file (no build identity) and the key back to runs |

## Disk each repository's history needs

Measured on this machine (bare partial clones, `--depth 300`, after one run of 30 to 40 changes had fetched the blobs it needed). Commit and tree objects alone are small; blobs arrive on checkout, and a run adds the blobs of every replayed commit. Budget the bare clone plus one work tree.

| repository | commits fetched (first parent) | bare clone before any checkout | bare clone after a 40-change run | peak data directory during a run |
|---|---|---|---|---|
| NodeGoat | 461 (160) | 0.6 MB | 11 MB | ~50 MB |
| pygoat | 790 (267) | 1.3 MB | 22 MB | ~75 MB |
| full-stack-fastapi-template | 300 (300) | 0.4 MB | 0.5 MB (not run yet) | expect under 40 MB |
| juice-shop | 4325 (1085) | 4 MB | 29 MB | ~130 MB (work tree about 70 MB) |
| epic | 301 (300) | 0.4 MB | 14 MB | ~60 MB |
| plane | not fetched here (too large for this machine) | | expect 0.5 to 1 GB | expect 1 GB or more |
| cal.com | not fetched here (too large for this machine) | | expect 1 GB or more | expect 1.5 GB or more |

Run outputs are about 1 to 2 MB per 40 changes. Time per change: about 1 to 3 s on NodeGoat, pygoat and epic, about 30 s on juice-shop (two full scans with `--no-cache`).

## Commands

Set once (paths are examples; keep the data directory outside any checkout):

```bash
R=eval/replay/replay.py
DATA=/path/to/replay-data          # bare clones, work tree, outputs
BIN=/path/to/drift                 # the build to measure
```

Fetch history (once per repository; the URL and commit are the sample's own, from `git -C <sample> remote -v` and `rev-parse HEAD`):

```bash
fetch() {  # name url sha depth
  g=$DATA/$1.git
  git init --bare -q $g
  git -C $g config core.repositoryformatversion 1
  git -C $g config remote.origin.url $2
  git -C $g config remote.origin.promisor true
  git -C $g config remote.origin.partialclonefilter blob:none
  git -C $g config extensions.partialClone origin
  git -C $g config gc.auto 0
  nice -n 19 timeout 900 git -C $g fetch --no-tags --filter=blob:none --depth $4 origin $3:refs/heads/pinned
}
fetch NodeGoat https://github.com/OWASP/NodeGoat c5cb68a7084e4ae7dcc60e6a98768720a81841e8 300
fetch pygoat https://github.com/adeyosemanputra/pygoat 2aa4cc14f251e4a780e94e200aed6b36a5b15c21 300
fetch full-stack-fastapi-template https://github.com/fastapi/full-stack-fastapi-template aabb90126964a164e02aff39e7c385bb0598236d 300
fetch juice-shop https://github.com/juice-shop/juice-shop 266448aba68cd8ba5915f526a128da4fa7bc3f9f 300
fetch epic https://github.com/epicweb-dev/epic-stack 893610db76127fb5a5f1ffa786bee6b050637429 300
# Large: only on a machine with several GB free, one at a time.
fetch plane https://github.com/makeplane/plane 290383d7f92fa8995ea2adbd12442220b3b9b525 150
fetch cal.com https://github.com/calcom/cal.com ae027bb70e694e2d2c44569f398d6cbcee0389b1 150
```

Plan, run, sample, score (one repository; repeat per repository, never two runs at once):

```bash
python3 -I $R plan --repo $DATA/pygoat.git --base-age 120 --window 40 --out $DATA/plans/pygoat.json
python3 -I $R run  --plan $DATA/plans/pygoat.json --bin $BIN --kinds all --accept all --out $DATA/runs/pygoat-new
python3 -I $R sample --runs $DATA/runs/pygoat-new --per-kind 30 --out $DATA/samples/pygoat.jsonl
# ... label the sample (LABELLING.md) ...
python3 -I $R score --labels $DATA/samples/pygoat.labelled.jsonl
```

For plane and cal.com, the roadmap asks for 50 replayed pull requests each for "new route with no guard" (`security:added_without_guard`), and a sample of 30 per kind for everything else:

```bash
python3 -I $R plan --repo $DATA/plane.git   --base-age 60 --window 50 --out $DATA/plans/plane.json
python3 -I $R plan --repo $DATA/cal.com.git --base-age 60 --window 50 --out $DATA/plans/cal.com.json
python3 -I $R run --plan $DATA/plans/plane.json   --bin $BIN --kinds all --accept all --out $DATA/runs/plane-new
python3 -I $R run --plan $DATA/plans/cal.com.json --bin $BIN --kinds all --accept all --out $DATA/runs/cal.com-new
python3 -I $R sample --runs $DATA/runs/plane-new $DATA/runs/cal.com-new --per-kind 30 --out $DATA/samples/large.jsonl
```

Old build against new, same plan, one blind sample:

```bash
python3 -I $R run --plan $DATA/plans/pygoat.json --bin $OLD_BIN --kinds all --accept all --out $DATA/runs/pygoat-old
python3 -I $R sample --runs $DATA/runs/pygoat-old $DATA/runs/pygoat-new --per-kind 30 --out $DATA/samples/pygoat-ab.jsonl
```

`run` refuses an `--out` under `/home/user`, removes its work tree when it ends (`--keep-work` keeps it), and stops before a checkout when the data directory passes 580 MB or `/` has less than 2.5 GB free (both constants at the top of `replay.py`; raise them on a machine of your own).
