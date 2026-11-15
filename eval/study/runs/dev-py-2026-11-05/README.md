# Dev run, Python (2026-11-05): first precision study of Python support

**Dev set, not held-out.** These 8 repos (`eval/repos-py.json`) are the Python dev set: findings on them drove product fixes (router subclasses from polar, per-method handlers from CTFd), so the numbers are dev numbers, not a held-out measurement.

## Commands

```sh
CARGO_TARGET_DIR=$SCRATCH/tgt-py-study cargo build --release --locked --bin drift   # copied to $SCRATCH/bin/drift-py-study
node eval/study/prepare.mjs --drift $SCRATCH/bin/drift-py-study --manifest eval/repos-py.json \
  --run eval/study/runs/dev-py-2026-11-05 --cache $SCRATCH/eval-py --drift-src .
node eval/study/recall.mjs sources --run eval/study/runs/dev-py-2026-11-05
node eval/study/prompt.mjs label --run eval/study/runs/dev-py-2026-11-05 --labeller A
```

Settings:

- binary sha256 `34ded3c35a36…`, `drift 0.1.0-dev`, built from main at `859542f4` (clean tree, recorded with `--drift-src`, not rebuilt by `prepare.mjs`);
- census `--max 15 --all-outliers`; pool `--max 200`; tier ≥ 15 members (not pre-registered: dev manifest);
- checkouts: the shared clones of `eval/oracle-py/run.py`, `$SCRATCH/eval-py/repos/<name>`, verified clean at the pinned sha.

No harness change was needed for Python: `prepare.mjs`, `lib.mjs` (census and YAML parsing, rule families) and `prompt.mjs` work unchanged. Re-running the TypeScript dev prepare (`runs/dev-2026-11-05`, same `drift-main` binary) with this harness gives byte-identical `proposals/`, `pool/` and `queue.json` items.

## Census

| Repo | Units | Roles | Shown | Python-side | Pool | Rule kinds |
| --- | --- | --- | --- | --- | --- | --- |
| full-stack-fastapi-template | 403 | 23 | 1 | 0 | 1 | prefers_library 1 |
| polar | 14,173 | 714 | 15 | 8 | 28 | wrapped_by/call 2, wrapped_by/decorator 1, wrapped_by/extends 1, passes_key 1, calls 4, renders 2, avoids(any) 1, named 3 |
| netbox | 6,523 | 345 | 15 | 15 | 40 | wrapped_by/decorator 4, wrapped_by/extends 3, passes_key 2, calls 2, avoids(import) 4 |
| saleor | 7,260 | 408 | 14 | 14 | 21 | wrapped_by/extends 1, wrapped_by/decorator 1, passes_key 2, named 5, avoids(import) 3, avoids(os_environ) 1, has_test 1 |
| CTFd | 1,566 | 119 | 5 | 5 | 6 | wrapped_by/decorator 1, avoids(import) 4 |
| flask | 260 | 13 | 1 | 1 | 1 | passes_key 1 |
| fastapi | 2,309 | 86 | 1 | 1 | 1 | control 1 |
| langchain | 3,742 | 205 | 1 | 1 | 1 | avoids(import) 1 |
| **Total** | | | **53** | **45** | 99 | |

"Python-side" counts proposals whose rule is about Python code. The other 8 are TypeScript proposals of mixed repos: polar's `clients/**` and `server/emails` (7), and the template's `frontend/` (1). They are in the queue and labelled like any other. For a Python-only number, exclude them at reporting time (`metrics.mjs --exclude-repos` works per repo only, so this needs the uid list below).

TypeScript-side uids: `full-stack-fastapi-template/D-6e757d`, `polar/D-dfae92`, `polar/D-9c16e6`, `polar/D-fb4011`, `polar/D-27ad3b`, `polar/D-26e577`, `polar/D-b63162`, `polar/D-5e2fc5`.

## Sanity check before labelling

No malformed proposals: every census id is in `conventions.yaml`, no id collides within or across repos, every proposal has a role, a rule, an example and evidence, and member and outlier counts match the evidence line. Mining matches `docs/v2/PYTHON.md` (proposal counts 1, 15, 15, 14, 5, 1, 1, 1).

Wording and grouping issues to watch for in the labels (not fixed here; mining is out of scope):

- `polar/D-fba5aa` "classes in polar/\*\* (schemas files) do not use \`any\`": the rule is `avoids any`, which for Python is `typing.Any`, but the summary uses the TypeScript word `any`.
- `polar/D-31bf00`: the variant list names `get_authentication_session()` twice. They are two functions (`server/polar/auth/authentication_session.py` and `server/polar/customer_portal/auth/authentication_session.py`); the summary does not say so. The list has 16 alternatives, including `get_db_session()` and `get_pagination_params()` (the first-call-wrap behaviour documented in PYTHON.md).
- CTFd's 4 layering proposals ("files in the repo do not import from CTFd/{cli,admin,api,plugins}/\*\*") have `.eslintrc.js` as their example: the "files in the repo" role pools JavaScript files with Python modules, so a JS file stands for a Python import rule and the member count (229) includes files that cannot import a Python package.
- netbox's 4 layering proposals have `.claude/skills/draft-release-notes/audit_milestone.py`, an agent-skill script, as their example.

## Labelling

Label prompts for A are rendered (`prompts/label/A/<repo>.md`, outboxes in `prompts/index.json`). B is rendered per repo only after A's output for that repo is collected (`prompt.mjs` enforces it). Record here which model ran A, B and C, and any isolation weaker than the prompts assume.
