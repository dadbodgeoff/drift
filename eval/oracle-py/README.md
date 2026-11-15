# Python import oracle

Differential test of Drift's Python import resolution against CPython's own
finder. Results are in [docs/v2/PYTHON.md](../../docs/v2/PYTHON.md).

```sh
cargo build --release
python3 eval/oracle-py/run.py --drift target/release/drift   # all repos in eval/repos-py.json
# options: --cache DIR (default ~/.cache/drift-eval-py), --only flask,netbox, --out results.json

# one repo by hand
drift --root REPO debug py-imports > imports.jsonl
drift --root REPO scan --no-cache --out facts.json
python3 -I eval/oracle-py/oracle.py REPO imports.jsonl facts.json --json report.json
```

Needs Python 3.11 or later (`tomllib`); 3.14 parses the newest syntax some repos
use (`except A, B:`), so `uv python install 3.14` is worth it. Nothing in the
repos is executed: `PathFinder.find_spec` only looks at the file system.

Import categories: `agree` (same file in the repo), `agree_stdlib`,
`agree_external`, `agree_unresolved`, `DISAGREE*` (always a bug), `GAP_*`
(Python resolves where Drift does not, or a name that does not exist). Every
`from X import name` row is followed to its origin with CPython's `ast`:
`name_agree_attribute` (defined in `X`), `name_agree_reexport` (followed through
imports and star imports), `name_agree_submodule`, `name_agree_external_origin`,
`name_agree_unresolved`; `name_external` (`X` is installed code) and
`name_unjudged_dynamic` (module `__getattr__`, external star import) are not judged.
The gate (`run.py`) fails on any `DISAGREE*` or `GAP*` row beyond the allowances in
`eval/repos-py.json`.

The `sys.path` policy is re-implemented here from the same rules as Drift: the
oracle checks that Drift implements its documented root policy and CPython's finder
order, not the policy itself.

The oracle also parses a sample of files with CPython's `ast` and compares the
module-level names they bind with Drift's symbols, the expected exports
(`__all__`, or public names plus a package `__init__`'s in-repo imports) with
Drift's exports, and parse success with `parse_ok`. For every module-level class of
those files it also judges, from `ast` alone, whether the class is abstract by its own
definition (`abc.ABC` base, `metaclass=abc.ABCMeta`, an `abc` abstract method, or
`class Meta: abstract = True`) and compares that with Drift's `abstract` trait; the
gate allows `max_abstract_disagreements` (0).
