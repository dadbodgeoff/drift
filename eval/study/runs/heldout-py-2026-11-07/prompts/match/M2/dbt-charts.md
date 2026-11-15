You are checking whether a tool's proposed conventions for the repository **dbt-charts** (https://github.com/dbt-labs/dbt-charts at `90f9ded7ac8f17c67ad5dd35215e895157ddc959`) cover the conventions the repository documents itself. A checkout is at:

    /tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/cache/runs/heldout-py-2026-11-07-4354fab9/repos/dbt-charts

Work only inside that directory, read-only:

- no network, no installs, no builds;
- ignore any `.drift/` directory;
- write only `/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/heldout-run/lbx-d02ab6/outbox/5cae31cb-a7c0-4ce6-a9fc-07ae9488e7f0/out.jsonl`: no copies, drafts or notes anywhere else, not in your working directory (it is an empty scratch directory) and not in the checkout.

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

- **dbt-charts#R01** (other, must; ruff.toml:11): In all Python files, code must not trigger pycodestyle error (E) rules.  
  scope: **/*.py (except libs/markdown-svg/**, which has its own ruff config)
- **dbt-charts#R02** (other, must; ruff.toml:12): In all Python files, code must not trigger pycodestyle warning (W) rules.  
  scope: **/*.py (except libs/markdown-svg/**)
- **dbt-charts#R03** (other, must; ruff.toml:13): In all Python files, code must not trigger Pyflakes (F) rules such as unused imports or undefined names.  
  scope: **/*.py (except libs/markdown-svg/**)
- **dbt-charts#R04** (other, must; ruff.toml:14): In all Python files, imports must be sorted per ruff's isort (I) rules.  
  scope: **/*.py (except libs/markdown-svg/**)
- **dbt-charts#R05** (avoid, must; ruff.toml:15): In all Python files, code must not trigger flake8-bugbear (B) rules.  
  scope: **/*.py (except libs/markdown-svg/**)
- **dbt-charts#R06** (avoid, must; ruff.toml:16): In all Python files, code must not trigger flake8-comprehensions (C4) rules (unnecessary list/dict/set calls and comprehensions).  
  scope: **/*.py (except libs/markdown-svg/**)
- **dbt-charts#R07** (other, must; ruff.toml:17): In all Python files, Django code must not trigger flake8-django (DJ) rules.  
  scope: **/*.py (except libs/markdown-svg/**)
- **dbt-charts#R08** (other, must; ruff.toml:18): In all Python files, code must use modern Python 3.11 syntax per pyupgrade (UP) rules.  
  scope: **/*.py (except libs/markdown-svg/**)
- **dbt-charts#R09** (other, must; ruff.toml:19): In all Python files, code must not trigger flake8-simplify (SIM) rules.  
  scope: **/*.py (except libs/markdown-svg/**)
- **dbt-charts#R10** (error_handling, must; ruff.toml:20): In all Python files, code must not use a try/except whose handler is only `pass`.  
  scope: **/*.py (except libs/markdown-svg/**)
- **dbt-charts#R11** (error_handling, must; ruff.toml:21): In all Python files, code must not catch broad Exception/BaseException without re-raising (exceptions carry `# noqa: BLE001 — <reason>`).  
  scope: **/*.py (except libs/markdown-svg/**)
- **dbt-charts#R12** (error_handling, must; ruff.toml:22): In all Python files, code must not raise the bare built-in `Exception` class; raise a specific exception type.  
  scope: **/*.py (except libs/markdown-svg/**)
- **dbt-charts#R13** (testing, must; ruff.toml:23): In test files, pytest code must follow flake8-pytest-style (PT) rules.  
  scope: **/tests/**/*.py, conftest.py
- **dbt-charts#R14** (typing, must; ruff.toml:24): In shipped (non-test) Python source, every function parameter must have a type annotation.  
  scope: **/*.py except **/tests/** and **/conftest.py (and libs/markdown-svg/**)
- **dbt-charts#R15** (typing, must; ruff.toml:25): In shipped (non-test) Python source, every public function must declare a return type annotation.  
  scope: **/*.py except **/tests/** and **/conftest.py (and libs/markdown-svg/**)
- **dbt-charts#R16** (typing, must; ruff.toml:26): In shipped (non-test) Python source, every private function must declare a return type annotation.  
  scope: **/*.py except **/tests/** and **/conftest.py (and libs/markdown-svg/**)
- **dbt-charts#R17** (typing, must; ruff.toml:27): In shipped (non-test) Python source, `*args` parameters must have a type annotation.  
  scope: **/*.py except **/tests/** and **/conftest.py (and libs/markdown-svg/**)
- **dbt-charts#R18** (typing, must; ruff.toml:28): In shipped (non-test) Python source, `**kwargs` parameters must have a type annotation.  
  scope: **/*.py except **/tests/** and **/conftest.py (and libs/markdown-svg/**)
- **dbt-charts#R19** (typing, must; ruff.toml:29): In shipped (non-test) Python source, special (dunder) methods such as `__init__` must declare a return type annotation.  
  scope: **/*.py except **/tests/** and **/conftest.py (and libs/markdown-svg/**)
- **dbt-charts#R26** (calls, must; ruff.toml:44): In all Python files, code must use pathlib instead of os.path / open() style filesystem calls (flake8-use-pathlib).  
  scope: **/*.py (except libs/markdown-svg/**)
- **dbt-charts#R27** (argument, must; ruff.toml:45): In all Python files, open(), Path.read_text() and Path.write_text() calls must pass an explicit `encoding=` argument.  
  scope: **/*.py (except libs/markdown-svg/**)
- **dbt-charts#R32** (other, must; ruff.toml:61): In all Python files, aliased imports from the same module must be combined into a single `from x import a as b, c` statement.  
  scope: **/*.py (except libs/markdown-svg/**)
- **dbt-charts#R33** (import_restriction, must; src/dbt_charts/core/ruff.toml:4): In src/dbt_charts/core, code must not use any API listed in flake8-tidy-imports banned-api.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R34** (import_restriction, must; src/dbt_charts/core/ruff.toml:7): In src/dbt_charts/core, code must not call os.getcwd; project_root must be passed in.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R35** (import_restriction, must; src/dbt_charts/core/ruff.toml:8): In src/dbt_charts/core, code must not read os.environ; values must be passed in at the composition root.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R36** (import_restriction, must; src/dbt_charts/core/ruff.toml:9): In src/dbt_charts/core, code must not call os.getenv; values must be passed in at the composition root.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R37** (import_restriction, must; src/dbt_charts/core/ruff.toml:14): In src/dbt_charts/core, code must not use pathlib.Path; use PurePosixPath for lexical path math and go through Project for project-file access.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R38** (import_restriction, must; src/dbt_charts/core/ruff.toml:17): In src/dbt_charts/core, code must not call os.walk; traverse files via Project.iter_files().  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R39** (import_restriction, must; src/dbt_charts/core/ruff.toml:18): In src/dbt_charts/core, code must not call os.listdir; traverse files via Project.iter_files().  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R40** (import_restriction, must; src/dbt_charts/core/ruff.toml:19): In src/dbt_charts/core, code must not call os.scandir; traverse files via Project.iter_files().  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R41** (import_restriction, must; src/dbt_charts/core/ruff.toml:20): In src/dbt_charts/core, code must not call glob.glob; traverse files via Project.iter_files().  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R42** (import_restriction, must; src/dbt_charts/core/ruff.toml:21): In src/dbt_charts/core, code must not call glob.iglob; traverse files via Project.iter_files().  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R43** (import_restriction, must; src/dbt_charts/core/ruff.toml:22): In src/dbt_charts/core, code must not call io.open; open files through Project.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R44** (import_restriction, must; src/dbt_charts/core/ruff.toml:23): In src/dbt_charts/core, code must not call codecs.open; open files through Project.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R45** (import_restriction, must; src/dbt_charts/core/ruff.toml:24): In src/dbt_charts/core, code must not call os.stat; probe existence via Project.exists().  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R46** (import_restriction, must; src/dbt_charts/core/ruff.toml:25): In src/dbt_charts/core, code must not call os.access; probe existence via Project.exists().  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R47** (import_restriction, must; src/dbt_charts/core/ruff.toml:26): In src/dbt_charts/core, code must not call os.path.exists; probe existence via Project.exists().  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R48** (import_restriction, must; src/dbt_charts/core/ruff.toml:27): In src/dbt_charts/core, code must not call os.path.isfile; probe existence via Project.exists().  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R49** (import_restriction, must; src/dbt_charts/core/ruff.toml:28): In src/dbt_charts/core, code must not call os.path.isdir; probe existence via Project.exists().  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R50** (import_restriction, must; src/dbt_charts/core/ruff.toml:29): In src/dbt_charts/core, code must not call os.remove; mutate files through Project.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R51** (import_restriction, must; src/dbt_charts/core/ruff.toml:30): In src/dbt_charts/core, code must not call os.unlink; mutate files through Project.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R52** (import_restriction, must; src/dbt_charts/core/ruff.toml:31): In src/dbt_charts/core, code must not call os.mkdir; mutate files through Project.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R53** (import_restriction, must; src/dbt_charts/core/ruff.toml:32): In src/dbt_charts/core, code must not call os.makedirs; mutate files through Project.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R54** (import_restriction, must; src/dbt_charts/core/ruff.toml:33): In src/dbt_charts/core, code must not call os.rename; mutate files through Project.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R55** (import_restriction, must; src/dbt_charts/core/ruff.toml:34): In src/dbt_charts/core, code must not call os.replace; mutate files through Project.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R56** (import_restriction, must; src/dbt_charts/core/ruff.toml:35): In src/dbt_charts/core, code must not call shutil.copy; mutate files through Project.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R57** (import_restriction, must; src/dbt_charts/core/ruff.toml:36): In src/dbt_charts/core, code must not call shutil.copytree; mutate files through Project.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R58** (import_restriction, must; src/dbt_charts/core/ruff.toml:37): In src/dbt_charts/core, code must not call shutil.move; mutate files through Project.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R59** (import_restriction, must; src/dbt_charts/core/ruff.toml:38): In src/dbt_charts/core, code must not call shutil.rmtree; mutate files through Project.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R60** (import_restriction, must; src/dbt_charts/core/ruff.toml:39): In src/dbt_charts/core, code must not call tempfile.mkstemp; temp files are an embedding-host concern.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R61** (import_restriction, must; src/dbt_charts/core/ruff.toml:40): In src/dbt_charts/core, code must not call tempfile.mkdtemp; temp dirs are an embedding-host concern.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R62** (import_restriction, must; src/dbt_charts/core/ruff.toml:41): In src/dbt_charts/core, code must not use tempfile.NamedTemporaryFile; temp files are an embedding-host concern.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R63** (import_restriction, must; src/dbt_charts/core/ruff.toml:42): In src/dbt_charts/core, code must not use tempfile.TemporaryDirectory; temp dirs are an embedding-host concern.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R64** (other, must; libs/markdown-svg/pyproject.toml:17): In libs/markdown-svg, Python code must not trigger pycodestyle error (E) rules.  
  scope: libs/markdown-svg/**/*.py
- **dbt-charts#R65** (other, must; libs/markdown-svg/pyproject.toml:17): In libs/markdown-svg, Python code must not trigger Pyflakes (F) rules.  
  scope: libs/markdown-svg/**/*.py
- **dbt-charts#R66** (other, must; libs/markdown-svg/pyproject.toml:17): In libs/markdown-svg, imports must be sorted per ruff's isort (I) rules.  
  scope: libs/markdown-svg/**/*.py
- **dbt-charts#R67** (naming, must; libs/markdown-svg/pyproject.toml:17): In libs/markdown-svg, names must follow pep8-naming (N) conventions.  
  scope: libs/markdown-svg/**/*.py
- **dbt-charts#R68** (avoid, must; libs/markdown-svg/pyproject.toml:17): In libs/markdown-svg, Python code must not trigger flake8-bugbear (B) rules.  
  scope: libs/markdown-svg/**/*.py
- **dbt-charts#R69** (avoid, must; libs/markdown-svg/pyproject.toml:17): In libs/markdown-svg, Python code must not trigger flake8-comprehensions (C4) rules.  
  scope: libs/markdown-svg/**/*.py
- **dbt-charts#R70** (other, must; libs/markdown-svg/pyproject.toml:17): In libs/markdown-svg, Python code must not trigger flake8-simplify (SIM) rules.  
  scope: libs/markdown-svg/**/*.py
- **dbt-charts#R71** (typing, must; libs/markdown-svg/pyproject.toml:17): In libs/markdown-svg non-test source, every function parameter must have a type annotation.  
  scope: libs/markdown-svg/**/*.py except tests/**
- **dbt-charts#R72** (typing, must; libs/markdown-svg/pyproject.toml:17): In libs/markdown-svg non-test source, `*args` parameters must have a type annotation.  
  scope: libs/markdown-svg/**/*.py except tests/**
- **dbt-charts#R73** (typing, must; libs/markdown-svg/pyproject.toml:17): In libs/markdown-svg non-test source, `**kwargs` parameters must have a type annotation.  
  scope: libs/markdown-svg/**/*.py except tests/**
- **dbt-charts#R74** (typing, must; libs/markdown-svg/pyproject.toml:17): In libs/markdown-svg non-test source, public functions must declare a return type annotation.  
  scope: libs/markdown-svg/**/*.py except tests/**
- **dbt-charts#R75** (typing, must; libs/markdown-svg/pyproject.toml:17): In libs/markdown-svg non-test source, private functions must declare a return type annotation.  
  scope: libs/markdown-svg/**/*.py except tests/**
- **dbt-charts#R76** (typing, must; libs/markdown-svg/pyproject.toml:17): In libs/markdown-svg non-test source, special (dunder) methods must declare a return type annotation.  
  scope: libs/markdown-svg/**/*.py except tests/**
- **dbt-charts#R82** (layering, must; tach.toml:11): In src/ and tests/, tach modules must not have circular import dependencies.  
  scope: src/**, tests/** (tach modules)
- **dbt-charts#R83** (layering, must; tach.toml:10): In src/dbt_charts, lower layers must not import higher layers: core modules must not import agent_api or surface (dbt_charts.ai) modules, and agent_api must not import surface modules.  
  scope: src/dbt_charts/** layered modules
- **dbt-charts#R84** (import_restriction, must; tach.toml:28): In src/ and tests/, code must only import third-party packages declared in pyproject.toml [project] dependencies or listed in tach.toml [external].exclude.  
  scope: src/**, tests/**
- **dbt-charts#R85** (layering, must; tach.toml:154): In dbt_charts.core (outside its carved-out submodules), code must only import first-party modules in its depends_on list (core.attribution, aliases, colors, column_types, diagnostics, compile, dbt_manifest, font_measure, fonts, links, numeric, constants, utils, text, dialects).  
  scope: src/dbt_charts/core/**
- **dbt-charts#R86** (layering, must; tach.toml:182): In dbt_charts.core.diagnostics, code must not import any other first-party module (leaf node).  
  scope: src/dbt_charts/core/diagnostics/**
- **dbt-charts#R87** (layering, must; tach.toml:192): In dbt_charts.core.aliases, code must not import any other first-party module (leaf node).  
  scope: src/dbt_charts/core/aliases*
- **dbt-charts#R88** (layering, must; tach.toml:202): In dbt_charts.core.colors, code must only import dbt_charts.core.diagnostics among first-party modules.  
  scope: src/dbt_charts/core/colors*
- **dbt-charts#R89** (layering, must; tach.toml:209): In dbt_charts.core.column_types, code must only import dbt_charts.core.diagnostics among first-party modules.  
  scope: src/dbt_charts/core/column_types*
- **dbt-charts#R90** (layering, must; tach.toml:217): In dbt_charts.core.links, code must not import any other first-party module (leaf node).  
  scope: src/dbt_charts/core/links*
- **dbt-charts#R91** (layering, must; tach.toml:225): In dbt_charts.core.attribution, code must not import any other first-party module (leaf node).  
  scope: src/dbt_charts/core/attribution*
- **dbt-charts#R92** (layering, must; tach.toml:230): In dbt_charts.core.fonts, code must not import any other first-party module (leaf node).  
  scope: src/dbt_charts/core/fonts*
- **dbt-charts#R93** (layering, must; tach.toml:235): In dbt_charts.core.font_measure, code must only import dbt_charts.core.fonts among first-party modules.  
  scope: src/dbt_charts/core/font_measure*
- **dbt-charts#R94** (layering, must; tach.toml:240): In dbt_charts.core.text, code must only import dbt_charts.core.utils and dbt_charts.core.numeric among first-party modules (no compile/render/execute).  
  scope: src/dbt_charts/core/text/**
- **dbt-charts#R95** (layering, must; tach.toml:245): In dbt_charts.core.utils, code must only import dbt_charts.core.font_measure among first-party modules.  
  scope: src/dbt_charts/core/utils*
- **dbt-charts#R96** (layering, must; tach.toml:255): In dbt_charts.core.dialects, code must not import any other first-party module (leaf node).  
  scope: src/dbt_charts/core/dialects*
- **dbt-charts#R97** (layering, must; tach.toml:261): In dbt_charts.core.constants, code must not import any other first-party module and must hold only plain typed constant values.  
  scope: src/dbt_charts/core/constants*
- **dbt-charts#R98** (layering, must; tach.toml:269): In dbt_charts.core.numeric, code must not import any other first-party module or dbt charts-specific types (leaf node).  
  scope: src/dbt_charts/core/numeric*
- **dbt-charts#R99** (layering, must; tach.toml:278): In dbt_charts.core.dbt_manifest, code must only import dbt_charts.core.diagnostics among first-party modules, and the dbt.contracts import must stay function-local (no heavy top-level imports).  
  scope: src/dbt_charts/core/dbt_manifest*
- **dbt-charts#R100** (layering, must; tach.toml:294): In dbt_charts.core.compile, code must not import dbt_charts.core.render or dbt_charts.core.execute; it may only import its listed leaf modules (aliases, attribution, colors, column_types, diagnostics, font_measure, links, numeric, constants, fonts, text, utils, dialects), with pre-existing exceptions marked by inline `# tach-ignore(...)` with a rationale.  
  scope: src/dbt_charts/core/compile/**
- **dbt-charts#R101** (layering, must; tach.toml:321): In dbt_charts.agent_api, code must not import dbt_charts.cli or dbt_charts.cli.filesystem_project at runtime; FilesystemProject may be referenced only under TYPE_CHECKING and an injected Project used instead.  
  scope: src/dbt_charts/agent_api/**
- **dbt-charts#R102** (layering, must; tach.toml:333): In dbt_charts.cli, code must route through dbt_charts.agent_api and must not import dbt_charts.core (or dbt_charts.ai) directly; only agent_api, cli.filesystem_project, cloud_client and telemetry may be imported.  
  scope: src/dbt_charts/cli/**
- **dbt-charts#R103** (layering, must; tach.toml:349): In dbt_charts.cloud_client, code must not import any other first-party module (no core, no agent_api).  
  scope: src/dbt_charts/cloud_client/**
- **dbt-charts#R104** (import_restriction, must; tach.toml:345): In src/, code must not import Django.  
  scope: src/**/*.py
- **dbt-charts#R105** (layering, must; tach.toml:356): In dbt_charts.telemetry, code must not import any other first-party module, and telemetry must be imported only by dbt_charts.cli (not core or agent_api).  
  scope: src/dbt_charts/telemetry/**
- **dbt-charts#R106** (layering, must; tach.toml:366): FilesystemProject must be constructed only within dbt_charts.cli (dbt_charts.cli.filesystem_project); core, agent_api and ai may reference it only under TYPE_CHECKING, and cli.filesystem_project may import only dbt_charts.core and dbt_charts.core.compile.  
  scope: src/dbt_charts/cli/filesystem_project*, src/dbt_charts/**
- **dbt-charts#R108** (layering, must; tach.toml:386): In dbt_charts.ai, code must not import dbt_charts.cli or dbt_charts.cli.filesystem_project; it consumes an injected Project and must not construct FilesystemProject.  
  scope: src/dbt_charts/ai/**
- **dbt-charts#R109** (layering, must; tach.toml:391): In dbt_charts.ai.tools, code must not import dbt_charts.ai.mcp; tools own the canonical implementations and mcp wraps tools.  
  scope: src/dbt_charts/ai/tools/**
- **dbt-charts#R110** (typing, must; pyrightconfig.json:5): In src/, tests/ (minus excluded subtrees), scripts/, libs/markdown-svg and libs/d3-format, code must pass pyright in standard type-checking mode.  
  scope: src/**, tests/** (excluding listed subtrees), scripts/**, libs/markdown-svg/**, libs/d3-format/**
- **dbt-charts#R112** (import_restriction, should; pyrightconfig.json:46): In pyright-checked code, unresolvable imports should not occur (reported as warning because dbt_charts_super_schema is optional).  
  scope: pyright include paths
- **dbt-charts#R113** (typing, should; pyrightconfig.json:47): In pyright-checked code, subclasses should not override a base-class variable with an incompatible type.  
  scope: pyright include paths
- **dbt-charts#R114** (typing, must; pyrightconfig.json:48): In pyright-checked code, code must not use typing.cast where the value already has the target type.  
  scope: pyright include paths
- **dbt-charts#R115** (typing, must; pyrightconfig.json:49): In pyright-checked code, unhashable values must not be used as dict keys or set members.  
  scope: pyright include paths
- **dbt-charts#R116** (avoid, must; pyrightconfig.json:50): In pyright-checked code, code must not use deprecated APIs or deprecated typing forms.  
  scope: pyright include paths
- **dbt-charts#R117** (naming, must; pyrightconfig.json:51): In pyright-checked code, ALL_CAPS constants must not be reassigned.  
  scope: pyright include paths
- **dbt-charts#R118** (import_restriction, must; pyrightconfig.json:52): In pyright-checked code, code must not contain unused imports.  
  scope: pyright include paths
- **dbt-charts#R119** (typing, must; pyrightconfig.json:53): In pyright-checked code, code must not contain comparisons that are always true or always false by type.  
  scope: pyright include paths
- **dbt-charts#R120** (typing, must; pyrightconfig.json:54): In pyright-checked code, code must not contain isinstance/issubclass checks that are always true by type.  
  scope: pyright include paths
- **dbt-charts#R121** (other, must; pyrightconfig.json:55): In pyright-checked code, private functions must not be left unused.  
  scope: pyright include paths
- **dbt-charts#R122** (other, must; pyrightconfig.json:56): In pyright-checked code, local variables must not be assigned and left unused.  
  scope: pyright include paths
- **dbt-charts#R123** (typing, must; pyrightconfig.json:57): In pyright-checked code, call arguments must match the parameter types.  
  scope: pyright include paths
- **dbt-charts#R124** (typing, must; pyrightconfig.json:58): In pyright-checked code, match statements must exhaustively handle all cases of the subject type.  
  scope: pyright include paths
- **dbt-charts#R125** (other, must; pyrightconfig.json:59): In pyright-checked code, code must not contain unreachable code.  
  scope: pyright include paths
- **dbt-charts#R126** (typing, must; pyrightconfig.json:60): In pyright-checked code, variables must not be used where they are possibly unbound.  
  scope: pyright include paths
- **dbt-charts#R127** (typing, must; pyrightconfig.json:61): In pyright-checked code, `# type: ignore` / `# pyright: ignore` comments must not be present where they suppress nothing.  
  scope: pyright include paths
- **dbt-charts#R128** (typing, must; pyrightconfig.json:62): In pyright-checked code, typing.assert_type calls must match the inferred type.  
  scope: pyright include paths
- **dbt-charts#R129** (avoid, should; pyrightconfig.json:63): In pyright-checked code, code should not access underscore-prefixed private members of other modules or classes.  
  scope: pyright include paths
- **dbt-charts#R130** (typing, must; pyrightconfig.json:64): In pyright-checked code, imported third-party packages must have type stubs (vendored under typings/ if needed).  
  scope: pyright include paths
- **dbt-charts#R131** (typing, must; pyrightconfig.json:65): In pyright-checked code, lambda parameters and return values must not have unknown types.  
  scope: pyright include paths
- **dbt-charts#R132** (typing, must; pyrightconfig.json:66): In pyright-checked code, generic types (list, dict, etc.) must be given explicit type arguments.  
  scope: pyright include paths
- **dbt-charts#R133** (typing, should; pyrightconfig.json:76): In src/dbt_charts/core/inspect/resolver.py, argument type mismatches are downgraded to warnings.  
  scope: src/dbt_charts/core/inspect/resolver.py
- **dbt-charts#R134** (other, must; pyproject.toml:330): In src/, tests/ and scripts/, code must not contain dead (unused) code detected by vulture at 80% confidence, except names whitelisted in vulture-whitelist.py or decorated with ignored decorators (Typer commands, MCP server handlers).  
  scope: src/**, tests/**, scripts/**
- **dbt-charts#R135** (other, must; scripts/check_models.py:6): In dbt_charts.core.compile.models, pydantic classes must not assign `model_config` a bare dict literal; use `ConfigDict(...)`.  
  scope: src/dbt_charts/core/compile/models/**/*.py
- **dbt-charts#R136** (base_class, must; scripts/check_models.py:10): In dbt_charts.core.compile.models, every class that directly subclasses `BaseModel` (excluding enums and dataclasses) must declare `model_config = ConfigDict(extra="forbid")`.  
  scope: src/dbt_charts/core/compile/models/**/*.py
- **dbt-charts#R137** (naming, must; scripts/check_models.py:15): In dbt_charts.core.compile.models, class names must not start with `Compiled`; the compiled stage uses the bare name (Board, Chart, Style).  
  scope: src/dbt_charts/core/compile/models/**/*.py
- **dbt-charts#R138** (file_layout, must; scripts/check_models.py:19): In dbt_charts.core.compile.models, module filenames must not end in `_types`; use authored.py / theme.py / normalized.py / resolved.py per subdirectory.  
  scope: src/dbt_charts/core/compile/models/**
- **dbt-charts#R139** (typing, must; scripts/check_models.py:22): In theme-stage model files (compile/models/style/theme/**, compile/models/config.py, compile/models/chart/normalized/**), every class field annotated `T | None = None` must carry a `#` justification comment on the same line or the line before.  
  scope: src/dbt_charts/core/compile/models/style/theme/**, src/dbt_charts/core/compile/models/config.py, src/dbt_charts/core/compile/models/chart/normalized/**
- **dbt-charts#R140** (typing, must; scripts/type_state_gate.py:8): In src/dbt_charts/core, added or modified lines must not introduce an unmarked `Any` annotation/reference (explicit_any) unless marked `# type-state: explicit_any — <reason>`.  
  scope: src/dbt_charts/core/**/*.py (changed lines)
- **dbt-charts#R141** (error_handling, must; scripts/type_state_counter.py:5): In src/dbt_charts/core, added or modified lines must not introduce silent fallbacks (`x or <literal>`, `d.get(k, default)`, 3-arg `getattr(o, a, default)`) unless marked `# type-state: silent_fallback — <reason>`; a missing value should error.  
  scope: src/dbt_charts/core/**/*.py (changed lines)
- **dbt-charts#R142** (typing, must; scripts/type_state_counter.py:8): In src/dbt_charts/core, added or modified lines must not introduce `cast(...)` calls unless marked `# type-state: cast — <reason>`.  
  scope: src/dbt_charts/core/**/*.py (changed lines)
- **dbt-charts#R143** (typing, must; scripts/type_state_counter.py:8): In src/dbt_charts/core, added or modified lines must not introduce `# type: ignore` comments unless marked `# type-state: type_ignore — <reason>`.  
  scope: src/dbt_charts/core/**/*.py (changed lines)
- **dbt-charts#R144** (typing, must; scripts/type_state_counter.py:8): In src/dbt_charts/core, added or modified lines must not use `object` in a type annotation (parameter, return or variable) unless marked `# type-state: object_annotation — <reason>`.  
  scope: src/dbt_charts/core/**/*.py (changed lines)
- **dbt-charts#R145** (typing, should; scripts/type_state_gate.py:9): In src/dbt_charts/core, new `Optional[...]` / `T | None` annotations should be avoided unless justified; the gate only reports them (non-blocking).  
  scope: src/dbt_charts/core/**/*.py (changed lines)
- **dbt-charts#R146** (other, must; scripts/type_state_gate.py:24): In src/dbt_charts/core, a type-state exception marker must be a comment of the form `# type-state: <category> — <reason>` with a known category, an em-dash separator and a non-empty reason.  
  scope: src/dbt_charts/core/**/*.py
- **dbt-charts#R147** (avoid, must; pyproject.toml:391): In shipped package content (src/dbt_charts, libs/markdown-svg/src/mdsvg, libs/d3-format/src/d3_format), code and comments must not contain internal decision-doc identifiers such as `(D14)` or `D-019`.  
  scope: src/dbt_charts/**, libs/markdown-svg/src/mdsvg/**, libs/d3-format/src/d3_format/**
- **dbt-charts#R148** (avoid, must; pyproject.toml:404): In shipped package content, code and comments must not contain internal task-letter references such as `Task C`.  
  scope: src/dbt_charts/**, libs/markdown-svg/src/mdsvg/**, libs/d3-format/src/d3_format/**
- **dbt-charts#R149** (avoid, must; pyproject.toml:405): In shipped package content, code and comments must not contain personal names or internal experiment/project names (`RJ`, `chart-lab`, `chart-workbench`, `company-overview`).  
  scope: src/dbt_charts/**, libs/markdown-svg/src/mdsvg/**, libs/d3-format/src/d3_format/**
- **dbt-charts#R150** (avoid, must; pyproject.toml:412): In shipped package content, code and comments must not reference internal repo paths `design/chart-briefs`, `design/experiments` or `apps/docs/`.  
  scope: src/dbt_charts/**, libs/markdown-svg/src/mdsvg/**, libs/d3-format/src/d3_format/**
- **dbt-charts#R151** (avoid, must; pyproject.toml:417): In shipped package content, code and comments must not reference internal planning docs `decisions.md`, `spec.md` or `design.md`.  
  scope: src/dbt_charts/**, libs/markdown-svg/src/mdsvg/**, libs/d3-format/src/d3_format/**
- **dbt-charts#R152** (avoid, must; pyproject.toml:385): In shipped package content, code must not contain the strings `us-west1-python.pkg.dev`, `internal-eng@`, `tasks/workstreams/` or `ai_notes/`.  
  scope: src/dbt_charts/**, libs/markdown-svg/src/mdsvg/**, libs/d3-format/src/d3_format/**
- **dbt-charts#R153** (avoid, must; pyproject.toml:386): In shipped package content, code must not contain credential-shaped tokens beginning with `ghp_`, `github_pat_`, `sk-`, `sk-ant-`, `AKIA` or `BEGIN PRIVATE KEY`.  
  scope: src/dbt_charts/**, libs/markdown-svg/src/mdsvg/**, libs/d3-format/src/d3_format/**
- **dbt-charts#R154** (file_layout, must; pyproject.toml:429): In src/dbt_charts/core/inspect, proprietary profiler modules (inspector.py, sources/super_schema.py, storage.py, grain_detector.py, relationship_detector.py, etc.) must not exist.  
  scope: src/dbt_charts/core/inspect/**
- **dbt-charts#R155** (import_restriction, must; pyproject.toml:479): In shipped package code, every third-party import must be a declared runtime dependency, except the lazily/conditionally imported allowlist (dbt_charts_super_schema, google, databricks, psycopg2, redshift_connector, snowflake, numpy, openai, metricflow_sql).  
  scope: src/dbt_charts/**, libs/markdown-svg/src/mdsvg/**, libs/d3-format/src/d3_format/**
- **dbt-charts#R156** (file_layout, must; pyproject.toml:275): In tests/, code must not add an `__init__.py` file.  
  scope: tests/**
- **dbt-charts#R157** (file_layout, must; .pre-commit-config.yaml:30): In the repository, file names must not conflict when compared case-insensitively.  
  scope: all files
- **dbt-charts#R158** (file_layout, must; .pre-commit-config.yaml:31): In the repository, file names must not be illegal on Windows (reserved names or characters).  
  scope: all files
- **dbt-charts#R159** (naming, must; src/dbt_charts/core/diagnostics/MESSAGING.md:12): In dbt_charts/core/diagnostics/codes_*.py, ErrorCode codes must be named `ERR-{DESCRIPTION}` and WarningCode codes `WARN-{DESCRIPTION}`, all caps, hyphen-separated, with no domain segment.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R160** (naming, must; src/dbt_charts/core/diagnostics/MESSAGING.md:15): In dbt_charts/core/diagnostics/codes_*.py, the DESCRIPTION part of a diagnostic code must name the failure or condition, not the fix.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R161** (other, must; src/dbt_charts/core/diagnostics/MESSAGING.md:19): In dbt_charts/core/diagnostics, code must not register two diagnostic codes that differ only by domain; they must be merged into one code.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R162** (error_handling, must; src/dbt_charts/core/diagnostics/MESSAGING.md:28): In diagnostic code definitions, `message_template` must state what failed with concrete values substituted via `{field!r}`/`{field}` placeholders and must never be a generic "something went wrong" message.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R163** (error_handling, should; src/dbt_charts/core/diagnostics/MESSAGING.md:31): In diagnostic code definitions, a single obvious fix should be stated in `message_template`, and `hint_generator` should be reserved for fixes needing computed context.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R164** (error_handling, must; src/dbt_charts/core/diagnostics/MESSAGING.md:35): In diagnostic code definitions, `message_template` must not contain raw `\n` unless the template is documented as intentionally multiline.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R165** (error_handling, must; src/dbt_charts/core/diagnostics/MESSAGING.md:39): In diagnostic templates, placeholders must be named after variables the raise/emit call site actually passes; no invented placeholders.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py and their raise/emit sites
- **dbt-charts#R166** (argument, must; src/dbt_charts/core/diagnostics/MESSAGING.md:45): In diagnostic code definitions, every `WarningCode(...)` must set `fix_template`.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R167** (argument, should; src/dbt_charts/core/diagnostics/MESSAGING.md:50): In diagnostic code definitions, `ErrorCode` should leave `fix_template` as None unless the fix text is long or reusable enough to warrant its own field.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R168** (error_handling, must; src/dbt_charts/core/diagnostics/MESSAGING.md:54): In diagnostic code definitions, the same fix text must not appear in both `message_template` and `fix_template`.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R169** (avoid, must; src/dbt_charts/core/diagnostics/MESSAGING.md:59): In diagnostic code definitions, `hint_generator` must only be used for computed context (e.g. suggest_close_source in hints.py) and must not be a lambda returning a static string literal.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R170** (argument, must; src/dbt_charts/core/diagnostics/MESSAGING.md:68): In diagnostic code definitions, every ErrorCode and WarningCode must set `docs_topic`.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R171** (naming, must; src/dbt_charts/core/diagnostics/MESSAGING.md:70): In diagnostic code definitions, `docs_topic` must be an H2 slug such as `charts` or `queries`, not a dotted namespace.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R172** (error_handling, must; src/dbt_charts/core/diagnostics/MESSAGING.md:79): In diagnostic templates, messages must lead with what failed or was detected, not an apology or hedge.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R173** (error_handling, must; src/dbt_charts/core/diagnostics/MESSAGING.md:80): In diagnostic templates, messages must not repeat in prose the file/range/chart/field already carried by the Diagnostic's structured fields.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R174** (error_handling, must; src/dbt_charts/core/diagnostics/MESSAGING.md:84): In diagnostic templates, messages must never describe the engine silently working around bad input; they explain why and how to fix the YAML.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R175** (calls, must; src/dbt_charts/core/diagnostics/MESSAGING.md:91): New diagnostic codes must be registered in the matching domain's dbt_charts/core/diagnostics/codes_*.py via `REGISTRY.register(ErrorCode(...))` or `REGISTRY.register(WarningCode(...))`.  
  scope: src/dbt_charts/core/diagnostics/codes_*.py
- **dbt-charts#R176** (import_restriction, should; src/dbt_charts/core/diagnostics/MESSAGING.md:93): A diagnostic code constant used by other modules should be imported (re-exported) in dbt_charts/core/diagnostics/__init__.py.  
  scope: src/dbt_charts/core/diagnostics/__init__.py
- **dbt-charts#R178** (avoid, must; src/dbt_charts/core/render/fonts/README.md:292): In render/theme code and CSS, oldstyle/tabular figure style must be selected by naming the font family (e.g. `dbt Serif Oldstyle Tabular`), never via `font-feature-settings: "onum"` or `font-variant-numeric: oldstyle-nums`.  
  scope: src/dbt_charts/core/render/**, theme definitions
- **dbt-charts#R179** (other, must; src/dbt_charts/core/render/fonts/README.md:323): Every (vendored family, cascaded weight) pair produced by built-in themes must have a row in `fonts.WEIGHT_FACE_ALIASES` mapping to a dedicated static face; a new weight must add a new static face, not a broader fallback.  
  scope: src/dbt_charts/core/fonts*, built-in themes
- **dbt-charts#R180** (file_layout, must; src/dbt_charts/core/render/fonts/README.md:350): In src/dbt_charts/core/render/fonts, `_font_face.css` must not be hand-edited; changes must go through `FONT_REGISTRY` and regeneration.  
  scope: src/dbt_charts/core/render/fonts/_font_face.css
- **dbt-charts#R181** (avoid, must; src/dbt_charts/core/render/fonts/README.md:351): In src/dbt_charts/core/render/fonts/_font_face.css, the file must not contain any comments (neither `/* */` CSS nor Jinja `{# #}`).  
  scope: src/dbt_charts/core/render/fonts/_font_face.css
- **dbt-charts#R183** (other, must; src/dbt_charts/core/inspect/CONTRACT.md:170): When TableInspection.to_dict()/to_json_dict() removes or renames a required key or changes a key's value type, PROFILER_CONTRACT_VERSION must get a major bump.  
  scope: src/dbt_charts/core/inspect/** (profiler contract)
- **dbt-charts#R184** (other, must; src/dbt_charts/core/inspect/CONTRACT.md:172): When TableInspection.to_dict()/to_json_dict() adds a new required key, PROFILER_CONTRACT_VERSION must get a minor bump (new optional keys need no bump).  
  scope: src/dbt_charts/core/inspect/** (profiler contract)

## Proposals shown to the user

```text
[D-e818b0] files in src/dbt_charts/agent_api/** have a test file
    evidence: 47/49 (lower bound 0.86, lift 2.0)
    example:  src/dbt_charts/agent_api/_link_scan.py#(file)
    outlier:  src/dbt_charts/agent_api/hex_project.py:1 (file)
    outlier:  src/dbt_charts/agent_api/inspect.py:1 (file)
```

```text
[D-f5c512] classes in src/dbt_charts/core/compile/** extend BaseModel
    evidence: 434/447 (lower bound 0.95, lift 1.5)
    example:  src/dbt_charts/core/compile/models/board/authored.py#AuthoredBoard
    outlier:  src/dbt_charts/core/compile/config.py:1236 ProjectSourcesConfig
    outlier:  src/dbt_charts/core/compile/migrations/migrations.py:126 Dropped
    outlier:  src/dbt_charts/core/compile/migrations/migrations.py:282 MigrationRegistry
    outlier:  src/dbt_charts/core/compile/models/style/resolved/geoshape.py:35 ResolvedGeoshapeChartStyle
    outlier:  src/dbt_charts/core/compile/models/style/theme/geoshape.py:32 GeoshapeChartStyle
    outlier:  src/dbt_charts/core/compile/models/style/theme/heatmap.py:40 HeatmapChartStyle
    outlier:  src/dbt_charts/core/compile/models/style/theme/kpi.py:219 KpiChartStyle
    outlier:  src/dbt_charts/core/compile/models/style/theme/pie.py:40 PieChartStyle
    outlier:  src/dbt_charts/core/compile/models/style/theme/point_map.py:32 PointMapChartStyle
    outlier:  src/dbt_charts/core/compile/models/style/theme/table.py:390 TableChartStyle
    outlier:  src/dbt_charts/core/compile/template/query_result.py:102 QueryResult
    outlier:  src/dbt_charts/core/compile/template/query_result.py:164 QueryResults
    outlier:  src/dbt_charts/core/compile/template/query_result.py:22 QueryRow
    exempt:   src/dbt_charts/core/compile/board_artifact.py:78 DanglingStyleRefError (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/core/compile/errors.py:271 FileValidationError (another kind of class (extends Exception))
    exempt:   src/dbt_charts/core/compile/errors.py:217 JinjaError (another kind of class (extends Exception))
    exempt:   src/dbt_charts/core/compile/errors.py:83 ParseError (another kind of class (extends Exception))
    exempt:   src/dbt_charts/core/compile/errors.py:171 ReferenceError (another kind of class (extends Exception))
    exempt:   src/dbt_charts/core/compile/errors.py:247 TemplateOutputTooLargeError (another kind of class (extends Exception))
    exempt:   src/dbt_charts/core/compile/errors.py:119 ValidationError (another kind of class (extends Exception))
    exempt:   src/dbt_charts/core/compile/migrations/migrations.py:62 IncompleteMigrationError (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/core/compile/migrations/migrations.py:54 MigrationConflictError (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/core/compile/migrations/migrations.py:76 SchemaMigrationWarning (another kind of class (extends UserWarning))
    exempt:   src/dbt_charts/core/compile/migrations/migrations.py:72 SchemaVersionTooOldError (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/core/compile/migrations/migrations.py:58 UnsupportedSchemaError (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/core/compile/normalize/variables.py:107 VariableReferenceErrors (another kind of class (extends Exception))
    exempt:   src/dbt_charts/core/compile/resolve/chart/_annotation_stats.py:22 FitError (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/core/compile/resolve/chart/_annotation_stats.py:26 TooFewRows (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/core/compile/resolve/style/palette.py:110 CategoricalOverrequestError (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/core/compile/resolve/style/palette.py:123 PatternAsPaletteError (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/core/compile/resolve/style/palette.py:114 SurfaceUnsupportedError (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/core/compile/resolve/style/palette.py:118 ToneAsPaletteError (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/core/compile/resolve/style/palette.py:106 UnknownColorError (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/core/compile/resolve/style/palette.py:102 UnknownPaletteError (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/core/compile/template/annotation_text.py:20 AnnotationTextError (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/core/compile/template/custom_template.py:54 CustomTemplateError (another kind of class (extends Exception))
    exempt:   src/dbt_charts/core/compile/template/output_budget.py:65 TemplateOutputBudgetExceeded (another kind of class (extends Exception))
    exempt:   src/dbt_charts/core/compile/template/query_result.py:70 QueryItems (another kind of class (extends list))
```

```text
[D-9f88d3] classes in src/dbt_charts/agent_api/** extend BaseModel
    evidence: 108/109 (lower bound 0.95, lift 1.5)
    example:  src/dbt_charts/agent_api/_link_scan.py#LinkHit
    outlier:  src/dbt_charts/agent_api/source_bundle.py:104 SourceBundle
    exempt:   src/dbt_charts/agent_api/_paths.py:384 PathOutsideProjectError (another kind of class (extends Exception))
    exempt:   src/dbt_charts/agent_api/examples.py:80 ExampleNotFound (another kind of class (extends Exception))
    exempt:   src/dbt_charts/agent_api/exposures.py:39 ExposuresError (another kind of class (extends ValueError))
    exempt:   src/dbt_charts/agent_api/mcp_install.py:93 McpConfigReadError (another kind of class (extends Exception))
    exempt:   src/dbt_charts/agent_api/serve.py:183 DetachedServeError (another kind of class (extends RuntimeError))
    exempt:   src/dbt_charts/agent_api/skill_install.py:68 SkillInstallError (another kind of class (extends Exception))
    exempt:   src/dbt_charts/agent_api/skill_render.py:77 MissingSurfaceAlias (another kind of class (extends KeyError))
    exempt:   src/dbt_charts/agent_api/skills.py:186 SkillNotFound (another kind of class (extends Exception))
```

```text
[D-e3cf08] functions in src/dbt_charts/core/render/warnings/** pass `fix` to Diagnostic.from_code()
    evidence: 63/63 (lower bound 0.94, lift 23.8)
    example:  src/dbt_charts/core/render/warnings/annotation_note_moved.py#detect
    exempt:   src/dbt_charts/core/render/warnings/base.py:221 chart_series (does not call Diagnostic.from_code())
    exempt:   src/dbt_charts/core/render/warnings/base.py:253 engine_warnings (does not call Diagnostic.from_code())
    exempt:   src/dbt_charts/core/render/warnings/base.py:200 listed_phrase (does not call Diagnostic.from_code())
    exempt:   src/dbt_charts/core/render/warnings/layer_data_outside_domain.py:51 layers_have_own_y_scale (does not call Diagnostic.from_code())
    exempt:   src/dbt_charts/core/render/warnings/layer_data_outside_domain.py:21 painted_float (does not call Diagnostic.from_code())
    exempt:   src/dbt_charts/core/render/warnings/layer_data_outside_domain.py:39 paints_outside_domain (does not call Diagnostic.from_code())
    exempt:   src/dbt_charts/core/render/warnings/registry.py:181 run_all (does not call Diagnostic.from_code())
    exempt:   src/dbt_charts/core/render/warnings/value_labels_crowd_width.py:25 painted_labels (does not call Diagnostic.from_code())
    exempt:   src/dbt_charts/core/render/warnings/x_axis.py:46 emitted_x_axis (does not call Diagnostic.from_code())
    exempt:   src/dbt_charts/core/render/warnings/x_axis.py:106 x_scale_type (does not call Diagnostic.from_code())
```

```text
[D-0f5597] exported values in src/dbt_charts/core/diagnostics/** call REGISTRY.register()
    evidence: 409/416 (lower bound 0.97, lift 2.3)
    example:  src/dbt_charts/core/diagnostics/codes_compile.py#ERR_ANNOTATION_INVALID
    outlier:  src/dbt_charts/core/diagnostics/codes_execute.py:693 UNKNOWN_RELATION_DIALECT_NOTES
    outlier:  src/dbt_charts/core/diagnostics/codes_retired.py:10 RETIRED_WARNING_CODES
    outlier:  src/dbt_charts/core/diagnostics/hints.py:42 CHART_RENDERING_SUCCESSORS
    outlier:  src/dbt_charts/core/diagnostics/hints.py:31 RETIRED_FORMAT_SUCCESSORS
    outlier:  src/dbt_charts/core/diagnostics/hints.py:158 RETIRED_VARIANT_FAMILIES
    outlier:  src/dbt_charts/core/diagnostics/hints.py:159 RETIRED_VARIANT_ROLE_PREFIX
    outlier:  src/dbt_charts/core/diagnostics/hints.py:147 RETIRED_VARIANT_SUFFIX_SUCCESSORS
    exempt:   src/dbt_charts/core/diagnostics/registry.py:21 CODED_VALIDATION_ERROR (in the module that defines REGISTRY.register)
    exempt:   src/dbt_charts/core/diagnostics/registry.py:16 ERROR_GUIDE_PATH (in the module that defines REGISTRY.register)
    exempt:   src/dbt_charts/core/diagnostics/registry.py:179 REGISTRY (in the module that defines REGISTRY.register)
```

## Pool: further proposals, not shown by default

(none)

## Output

One JSON object per documented item, one per line:

```json
{"ref": "dbt-charts#R01", "match": "PARTIAL", "proposals": ["D-015190"],
 "pool_match": "FULL", "pool_proposals": ["D-015190", "D-d24d21"],
 "followed": "mostly", "checked": ["apps/web/app/api/links/route.ts"],
 "reason": "D-015190 covers workspace routes only; with the pool's D-d24d21 all of app/api is covered."}
```

Use the proposal ids exactly as shown. When you finish, reply with one line: the counts of FULL, PARTIAL and NONE for `match`.
