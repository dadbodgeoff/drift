# Planted vulnerabilities

Eighteen vulnerabilities in common shapes, in one Express file and one Flask
file, and one control that must stay quiet. `expected.json` says what `drift
security --json` reports of each, and `crates/drift-cli/tests/planted_benchmark.rs`
holds every build to it: a miss that becomes a find, or a find that is lost, fails
the test until the entry is changed, so the score below is the build's.

| | Found | Missed | Controls flagged |
| --- | --- | --- | --- |
| First public snapshot (`f619e7d`) | 3 of 18 | 15 | 1 of 1 |
| This build | 16 of 18 | 2 | 0 of 1 |

The two misses, and why, are in `expected.json`. This is recall on shapes chosen
by the people who wrote the readers, on two files: it says that a shape is read,
not how often a finding in an unseen repository is real. The precision audit of
real repositories is in `../2026-11-07/README.md`.

Nothing here is served or run. The secrets are made up.
