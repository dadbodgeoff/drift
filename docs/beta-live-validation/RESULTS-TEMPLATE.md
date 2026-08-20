# Results template

Copy this into `results/NN-<slug>.md`. Do not reorder the sections; the compiler that merges
these into one report keys off the headings.

---

```markdown
# CHARTER NN — <name> — RESULTS

**Agent:** <model / session id>
**Run started:** <ISO-8601 with timezone>
**Run finished:** <ISO-8601 with timezone>
**Commit under test:** <full sha>  (`git rev-parse HEAD`)
**Working tree:** clean | dirty (`git status --porcelain` output verbatim if dirty)
**Engine binary:** <path> · built <ISO-8601> · `DRIFT_ENGINE_BIN` exported: yes/no
**Platform:** <uname -a>
**Node / pnpm / rustc:** <versions>

## 1. Verdict

One paragraph. What is now known that was not known before this charter ran. No hedging, no
recommendations, no "should".

| | Count |
|---|---|
| Probes specified | |
| Probes executed | |
| Probes blocked (could not be executed — see §5) | |
| Probes that behaved as the charter's oracle predicted | |
| Probes that did not | |
| Defects found not predicted by any suspect-list entry | |

## 2. Probe log

One row per probe, in charter order. Every row must be reproducible from its own command.

| Probe | Command (verbatim) | Exit | Observed | Oracle | Match |
|---|---|---|---|---|---|
| P-NN-01 | `...` | 0 | ... | ... | yes/no/blocked |

Long output goes in `results/artifacts/NN/P-NN-01.txt`, referenced by path, never pasted inline
beyond 20 lines.

## 3. Measurements

Benchmarks only. Every number carries: what was measured, how many trials, the spread, and the
exact command. A single-trial number is reported as a single-trial number, never as "the" number.

| Metric | n | Median | p95 | Min | Max | Command |
|---|---|---|---|---|---|---|

## 4. Suspect list disposition

Every entry from the charter's §8, dispositioned. No entry may be left out.

| ID | Claim under test | Disposition | Evidence |
|---|---|---|---|
| S-NN-1 | ... | CONFIRMED / REFUTED / NOT REACHABLE / INCONCLUSIVE | P-NN-04, artifact path |

- **CONFIRMED** — reproduced live, with a command that reproduces it.
- **REFUTED** — the predicted behavior did not occur, and the probe was capable of detecting it
  had it occurred. State how you know the probe was capable.
- **NOT REACHABLE** — no input exists that reaches the code path. Say why.
- **INCONCLUSIVE** — the probe ran but cannot distinguish. Say what would distinguish it.

## 5. Failures and blocks

For anything that failed, crashed, hung, or could not be run. One block per incident.

### F-NN-1 — <one-line title>

- **Probe:** P-NN-nn
- **Command:** verbatim
- **Expected:** ...
- **Observed:** verbatim output, exit code, stderr
- **Cause:** the actual mechanism, cited to `file:line`. If the cause is not established, say
  "cause not established" and state exactly what was ruled out.
- **Blast radius:** what else in this charter or another charter this invalidates.
- **Reproduction:** the shortest command sequence from a clean state that reproduces it.
- **Charter continued at:** P-NN-nn+1

## 6. Discovered surface not in the charter

Anything the charter did not anticipate: a command that exists but was not listed, a flag with no
documentation, a code path reached by accident. Facts only.

## 7. What this charter did not cover

Explicit. A charter that claims full coverage of its scope must say so and justify it. Anything
time-boxed away goes here with the reason.
```
