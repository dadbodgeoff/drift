## What

<!-- The change, in a few sentences. -->

## Why

<!-- The problem it solves; link the gap, issue or study finding. -->

## How it was verified

- [ ] `cargo fmt --all --check`, `cargo clippy --all-targets --locked -- -D warnings`, `cargo test --all --locked`, `cargo deny check`
- [ ] Parser changes: `eval/run.mjs` on the pinned repos, 0 disagreements / 0 gaps
- [ ] Mining changes: before/after precision on the dev set (`eval/study/`), new proposal ids listed for blind labelling
- [ ] Snapshot changes explained
- [ ] Studio: user-visible change (command, flag, `--json` field, rule kind, hook message, study output) is shown in Drift Studio, or the paired Studio PR is linked here: #___ (`apps/studio/docs/SYNC.md` updated; see CONTRIBUTING.md, "Studio")

<!-- Numbers and commands. -->

## Not done / known limits

<!-- What this does not cover, and anything a reviewer should look at closely. -->
