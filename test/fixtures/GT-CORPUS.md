# `gt-` fixtures — the ground-truth audit corpus

The `test/fixtures/gt-*` directories are the falsification audit's hand-built ground truth,
committed from `/tmp/gt-audit/fixtures/` (TDD §0, §4.1). They are the corpus the audit's
measured numbers were taken against, so they are kept byte-identical to what the audit ran,
with the exceptions recorded below.

| Fixture | What it is for |
|---|---|
| `gt-fact-extraction` | Default-export duplication (D2) — pages-router mini-repo |
| `gt-fact-extraction2` | Local `export { … }` miss (D3); arrow fn, class, interface |
| `gt-data-access` | `db`/`data-access` token boundary (D4), with near-miss negatives |
| `gt-auth-helper` | Auth-helper conformance/violation trio (regression control) |
| `gt-sensitive-fields` | D1 inference path — no `driftSensitive` markers |
| `gt-sensitive-fields-schema` | D1 marker path — `driftSensitive` annotated |

## Deviations from the audit's copies

- **Nested `.git` directories stripped.** Each audit fixture carried one; no pre-existing
  fixture in this directory does, and a nested `.git` cannot be committed as a normal tree.
  Nothing in the workflow needs it — `drift scan` runs fine without (every other fixture
  proves that).
- **`gt-sensitive-fields-schema/pages/api/route-safe.ts` added.** The audit's copy had only
  the leak route, but TDD §5.1 requires both D1 fixtures to assert 1 finding on the leak
  route *and* 0 on the safe route. It mirrors `gt-sensitive-fields/pages/api/route-safe.ts`
  with the `driftSensitive` marker kept, so the pair differs only in the marker.

## The rule that governs fixtures here

Per §4.3: any heuristic-driven detector's fixture must include lookalike negatives whose
*content* contradicts the name signal, and the test must assert silence on them. Recall-only
fixtures let substring heuristics look perfect — `gt-data-access` carries `dbg`, `imdb`,
`prismatic`, and `utils` for exactly this reason.
