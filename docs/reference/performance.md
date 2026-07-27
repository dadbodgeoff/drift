# Performance envelope

Measured on a synthetic 20,000-file repository (4,000 API routes, 20% violating, 16,200
supporting modules) on an M-series Mac. Absolute numbers are machine-specific; the shape is what
matters.

| Operation | 20k files | Notes |
|---|---|---|
| `drift start --accept-defaults` | **19.5s** | 20,201 files scanned, 86,004 facts, 800 baselined |
| `drift check --scope changed-files` (1 file) | **2.4s** | The edit-time path |
| `drift conventions list` | **0.1s** | |
| `drift scan status` | **0.6s** | |
| `drift ask` | **0.7s** | |
| `drift prepare` | **27.7s** | **Too slow.** See below. |
| `drift repo map` | **~100s** | **Too slow.** See below. |
| Local state | 226 MB | After T40's deduplication |

For comparison, cal.com (5,063 real files) onboards in ~34s — real files are larger and parse
slower per file than these synthetic ones, so onboarding is dominated by parsing rather than by
file count.

## Issue #99 (“queries time out”) is reproduced

`repo map` at ~100s and `prepare` at ~28s are the reproduction. Both genuinely consume the whole
fact graph, so this is not accidental loading — it is the graph query path not being designed for
this scale.

Profiling (`node --cpu-prof`) attributed `prepare`'s 31s to `listGraphNodes`, `listGraphEdges`
and `listGraphEvidence`, each called several times, plus ~5s of resulting garbage collection.

### What was fixed

`getFactGraphArtifact` hydrated the bulk collections eagerly, so **every** call ran three full
table scans over the graph — a regression introduced by T40's deduplication. Every current
consumer reads only `.graph.completeness` and `.graph.adapters`, so hydration is now lazy and
memoized behind getters: a consumer that needs the collections still gets them and pays only
then.

That took the light surfaces from 2.2s to 0.7s (`ask`) and 2.1s to 0.6s (`scan status`).

### What remains

`prepare` (27.7s) and `repo map` (~100s) still load and traverse the graph because they use it.
Fixing those needs one of:

- **Pagination** — `repo map` already accepts `--limit`/`--offset`, but builds the whole map first.
- **Indexed queries** — answer route-flow and dependency questions in SQL rather than by loading
  nodes and edges into memory and traversing them there.
- **Scoped loading** — `prepare` needs the neighbourhood of ≤10 files, not the entire graph.

Scoped loading is the most direct: `prepare`'s cost is proportional to repository size when it
should be proportional to the task.

### Why this matters beyond the number

`prepare` is the surface the context claim rests on, and the one an agent calls before writing
code. At 28s it is unusable in the edit loop that T44's hooks pack targets. Fixing it is a
prerequisite for that pack being worth shipping, not a follow-up to it.

## Memory

Peak resident set during onboarding of the same 20,000-file repository:

| Process | Peak RSS |
|---|---|
| Rust engine (`scan-repo`) | **93 MB** |
| Node CLI (`drift start`) | **1.76 GB** |

The engine parses every file and stays under 100 MB. The CLI uses nineteen times that doing
storage and graph assembly, because it holds the whole scan payload — 86,004 facts plus graph
nodes, edges and evidence — as JavaScript objects.

Heap required, measured by capping `--max-old-space-size`:

| Heap cap | 20k files |
|---|---|
| 512 MB | **crash** — `FATAL ERROR: JavaScript heap out of memory`, exit 134 |
| 1024 MB | ok |

That crash was uncontrolled: no Drift error, no failure code, no next action, and a partially
written database. Constrained CI runners cap Node's heap routinely, so it is a real configuration
rather than a contrived one. `doctor` now reports a `memory_headroom` check and `start` refuses up
front with the exact `NODE_OPTIONS` line to use.

**Working rule: budget ~52 KB of heap per indexable file.** 20k files needs ~1 GB; a 60k-file
monorepo would need ~3 GB and should be treated as unsupported until the CLI streams into storage
instead of buffering the whole payload.

## Reproducing

The synthetic repository generator is in the T42 entry of `docs/autonomous-run/log.jsonl`.
Onboarding it costs ~230 MB of state, so run `./scripts/reclaim-disk.sh` afterwards.
