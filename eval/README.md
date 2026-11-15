# Evaluation

`repos.json` pins public repos (by commit) that cover the shapes Drift must
handle: Next.js, Remix, Express (CommonJS), NestJS, Hono, Fastify, libraries and
large monorepos. `run.mjs` clones each one, then:

1. scans it (`drift scan`) and records files, time, parse errors and entry points;
2. compares every import and a sample of exports with the TypeScript compiler
   (`oracle/oracle.mjs`);
3. mines conventions (`drift census`);
4. fails if any repo has a parse error, a disagreement with the compiler, an
   in-repo import the compiler resolves but Drift does not, or export recall
   below the threshold in `repos.json`.

```sh
cargo build --release
npm install --prefix /tmp/oracle typescript@5
TS_PATH=/tmp/oracle/node_modules/typescript node eval/run.mjs --drift target/release/drift
# options: --cache DIR (default ~/.cache/drift-eval), --only dub,immich, --out results.json
```

The first full run downloads about 6 GB. Reports: `docs/v2/EVAL-16-REPOS-2026-11-05.md`.
To add a repo, append it to `repos.json` with a pinned `sha` and a `shape`.

## Python

`repos-py.json` pins 8 public Python repos (FastAPI, Flask, Django/DRF, Celery,
libraries, a monorepo). `oracle-py/run.py` scans each, compares every import with
CPython's `importlib` finder (`oracle-py/oracle.py`), mines conventions and fails on
any disagreement or gap. See [oracle-py/README.md](oracle-py/README.md) and
`docs/v2/PYTHON.md`.

`repos-py-2.json` is a second Python dev set for the precision study: 12 applications
(Django/DRF, Celery, FastAPI, Flask), pinned, with the study's rule-5 tier, `max` and
`pool` pre-registered for `eval/study/prepare.mjs`. Its selection criteria are in the
file; `node eval/study/select-holdout.mjs verify --dev eval/repos-py-2.json` checks it
against every held-out set, primary and secondary.

## Held-out sets and the precision study

`repos.json` is the **dev set**: Drift is tuned on it.

`holdout-primary.json` (18 TypeScript/JavaScript repos) and `holdout-primary-py.json` (10 Python repos) are the **primary frozen held-out sets** for precision, yield and recall, selected code-blind by `study/select-holdout.mjs`. `holdout.json` (18) and `holdout-py.json` (8) are **secondary** held-out sets (exposed; exploratory only). None of them may ever be used for tuning.

The protocol, rules and scripts are in [`study/README.md`](study/README.md); the commands of the primary held-out run, in order, are in [`study/HELDOUT-RUNBOOK.md`](study/HELDOUT-RUNBOOK.md).
