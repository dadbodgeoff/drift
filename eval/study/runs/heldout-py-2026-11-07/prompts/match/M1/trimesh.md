You are checking whether a tool's proposed conventions for the repository **trimesh** (https://github.com/mikedh/trimesh at `6c158cce226500fc64b12acd265af0cf01d1c212`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-py-2026-11-07-4354fab9/repos/trimesh

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/c5b262fc-c0ab-47d1-866d-266970d8f4f9/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

## Decide, for each documented item

**`match`**: compare against the **shown** proposals only.

- **FULL**: one shown proposal (or several together) states the same requirement on substantially the same scope. It would flag essentially the same violations as the documented rule.
  - Wording does not matter.
  - A proposal that lists alternatives ("wrapped in A() or B()") matches a document that allows the same alternatives.
  - Scope matches when the proposal's group covers most of the documented scope. If the document's scope is a whole package and the proposal covers the part of it where the rule actually applies, that also matches.
- **PARTIAL**: one of these:
  - the same requirement on a clearly narrower scope (one sub-area of several the document names);
  - only part of a compound requirement;
  - the same intent stated more weakly, so it would catch only some of the documented violations.
- **NONE**: anything else. Being about the same topic is not a match. For example, "routes call `getSession()`" does not match "routes must be wrapped in `withAuth()`".

**`pool_match`**: the same question, over shown **and** pool proposals. It is always at least as good as `match`.

**`followed`**: does the code follow the documented item?

1. Open two or three files in the item's scope.
2. Use grep to estimate how widely it is followed.
3. Answer `yes`, `mostly` (a few exceptions), `no`, or `unknown` (the scope has no code, or you cannot tell).

## Documented items

- **trimesh#R01** (other, must; docs/content/contributing.md:65): In trimesh/**, function and class docstrings must use the Sphinx Numpy-style format (Parameters / Returns sections).  
  scope: trimesh/**/*.py functions and classes
- **trimesh#R02** (calls, should; docs/content/contributing.md:70): In trimesh/**, deprecated public APIs should emit warnings.warn(..., category=DeprecationWarning, stacklevel=2) with a message naming the removal date and replacement, about one year before removal.  
  scope: trimesh/**/*.py deprecated public API functions
- **trimesh#R04** (avoid, should; docs/content/contributing.md:95): In trimesh/**, operations on face or vertex arrays should be vectorized numpy operations and must not use Python loops over faces or vertices unless unavoidable.  
  scope: trimesh/**/*.py all functions
- **trimesh#R05** (avoid, should; AI_PREFERENCE.md:13): In trimesh/**, code should use numpy operations and avoid Python loops, nested loops, conditionals inside loops and O(N^2) algorithms.  
  scope: trimesh/**/*.py all functions
- **trimesh#R06** (calls, should; README.md:154): In trimesh/**, public API changes should keep the old API emitting a DeprecationWarning for one year before removal.  
  scope: trimesh/**/*.py public API
- **trimesh#R07** (other, must; pyproject.toml:150): In all Python files, code must pass ruff flake8-bugbear (B) rules.  
  scope: **/*.py all files
- **trimesh#R08** (other, must; pyproject.toml:151): In all Python files, code must pass ruff C rules (flake8-comprehensions; mccabe C901 is ignored).  
  scope: **/*.py all files
- **trimesh#R09** (other, must; pyproject.toml:152): In all Python files, code must pass ruff pycodestyle error (E) rules.  
  scope: **/*.py all files
- **trimesh#R10** (other, must; pyproject.toml:153): In all Python files, code must pass ruff Pyflakes (F) rules (no unused imports/variables, undefined names).  
  scope: **/*.py all files
- **trimesh#R11** (other, must; pyproject.toml:154): In all Python files, imports must be sorted per ruff isort (I) rules.  
  scope: **/*.py all files
- **trimesh#R12** (other, must; pyproject.toml:155): In all Python files, code must pass ruff-specific (RUF) rules (RUF005 ignored).  
  scope: **/*.py all files
- **trimesh#R13** (other, must; pyproject.toml:156): In all Python files, code must use modern Python 3.10+ syntax per ruff pyupgrade (UP) rules.  
  scope: **/*.py all files
- **trimesh#R14** (other, must; pyproject.toml:157): In all Python files, code must pass ruff pycodestyle warning (W) rules.  
  scope: **/*.py all files
- **trimesh#R15** (avoid, must; pyproject.toml:158): In all Python files, code must not misuse sys.version / sys.version_info comparisons (flake8-2020 YTT).  
  scope: **/*.py all files
- **trimesh#R16** (avoid, must; pyproject.toml:159): In all Python files, code must not implicitly concatenate string literals on a single line (ISC001).  
  scope: **/*.py all files
- **trimesh#R17** (avoid, must; pyproject.toml:160): In all Python files, code must not implicitly concatenate string literals across lines using backslash continuation (ISC002).  
  scope: **/*.py all files
- **trimesh#R18** (avoid, must; pyproject.toml:161): In all Python files, code must not use numpy APIs removed or renamed in NumPy 2.0 (NPY201).  
  scope: **/*.py all files
- **trimesh#R19** (avoid, must; pyproject.toml:162): In trimesh/** (outside examples, tests, helpers, docs), code must not call print() or pprint() (T20).  
  scope: **/*.py except {examples,tests,helpers,docs}/*
- **trimesh#R20** (import_restriction, must; pyproject.toml:163): In all Python files (except per-file exemptions), code must not use the APIs listed in flake8-tidy-imports banned-api (TID251).  
  scope: **/*.py except examples/*, docs/*, tests/generic.py, tests/conftest.py
- **trimesh#R29** (avoid, must; pyproject.toml:179): In all Python files, string literals must not be implicitly concatenated even across multiple lines inside parentheses; use explicit + or a single literal.  
  scope: **/*.py all files
- **trimesh#R33** (import_restriction, must; pyproject.toml:193): In all Python files outside examples/docs and tests/{generic,conftest}.py, code must not use IPython.embed.  
  scope: **/*.py except examples/*, docs/*, tests/generic.py, tests/conftest.py
- **trimesh#R34** (import_restriction, must; pyproject.toml:194): In all Python files outside examples/docs and tests/{generic,conftest}.py, code must not import matplotlib.  
  scope: **/*.py except examples/*, docs/*, tests/generic.py, tests/conftest.py
- **trimesh#R35** (avoid, must; pyproject.toml:195): In all Python files outside examples/docs and tests/{generic,conftest}.py, code must not call numpy.empty; use numpy.zeros.  
  scope: **/*.py except examples/*, docs/*, tests/generic.py, tests/conftest.py
- **trimesh#R36** (avoid, must; pyproject.toml:196): In all Python files outside examples/docs and tests/{generic,conftest}.py, code must not call numpy.empty_like; use numpy.zeros / numpy.zeros_like.  
  scope: **/*.py except examples/*, docs/*, tests/generic.py, tests/conftest.py

## Proposals shown to the user

(none)

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "trimesh#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
