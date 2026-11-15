#!/usr/bin/env python3
"""Differential test of Drift's Python import resolution against importlib.

    drift --root REPO debug py-imports > imports.jsonl
    drift --root REPO scan --no-cache --out facts.json
    python3 -I eval/oracle-py/oracle.py REPO imports.jsonl facts.json [--samples 400] [--json out.json]

Imports: every import Drift saw is resolved again by CPython's own finder,
`importlib.machinery.PathFinder.find_spec`, over an emulated `sys.path`. No repo
code runs: finders only look at the file system.

The emulated `sys.path` for an importing file is derived here, independently of
Drift's Rust code, from the same packaging metadata (`pyproject.toml` read with
`tomllib`, `setup.cfg` with `configparser`, `setup.py` by pattern, `manage.py`):

1. the file's base directory (first ancestor without `__init__.py`),
2. the standard library (`sys.stdlib_module_names`),
3. its own project's package roots, its Django root, every other root, the repo root.

Relative imports are turned into absolute names with `importlib.util.resolve_name`
using the package the file has under the deepest root containing it.

`from X import name` rows check the attribute-versus-submodule rule: a name bound
at module level in `X` (by CPython's `ast`) is an attribute; otherwise an existing
submodule `X.name` is imported.

Exports and symbols: a sample of files is parsed with CPython's `ast` and the
module-level names it binds are compared with Drift's symbols and exports.

Limits: the import-root policy is the same on both sides (the oracle checks that
Drift implements it and Python's finder semantics correctly, not that a project is
really run with these roots); compiled extensions and `.pth` files are ignored; a
namespace directory without Python code (none within three levels) is treated
as absent (an installed distribution of that name would win).
"""

import argparse
import ast
import configparser
import importlib.machinery
import importlib.util
import json
import os
import re
import sys
import tomllib
from pathlib import Path

LEGACY_STDLIB = {
    "distutils", "imp", "asynchat", "asyncore", "smtpd", "cgi", "cgitb", "crypt", "nntplib",
    "pipes", "telnetlib", "uu", "xdrlib", "aifc", "audioop", "chunk", "imghdr", "mailcap",
    "msilib", "nis", "ossaudiodev", "sndhdr", "spwd", "sunau", "lib2to3",
}
# Added in 3.14, so a 3.13 interpreter gives the same answer as Drift's list.
NEW_STDLIB = {"_ast_unparse", "_hmac", "_py_warnings", "_remote_debugging", "_types", "_zstd", "annotationlib", "compression"}
STDLIB = set(sys.stdlib_module_names) | LEGACY_STDLIB | NEW_STDLIB
NOT_MODULES = {"node_modules", ".git", "__pycache__", ".venv", "venv", ".tox", ".nox", "site-packages"}


def inside(root: Path, p: Path) -> Path | None:
    p = Path(os.path.normpath(p))
    try:
        p.relative_to(root)
    except ValueError:
        return None
    return p


def get(d, *keys):
    for k in keys:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def as_list(v):
    if isinstance(v, str):
        return [v]
    if isinstance(v, list):
        return [x for x in v if isinstance(x, str)]
    return []


def configured_dirs(project: Path) -> list[str]:
    out: list[str] = []
    py = project / "pyproject.toml"
    if py.is_file():
        try:
            t = tomllib.loads(py.read_text(encoding="utf-8"))
        except Exception:
            t = {}
        pd = get(t, "tool", "setuptools", "package-dir")
        if isinstance(pd, dict) and isinstance(pd.get(""), str):
            out.append(pd[""])
        out += as_list(get(t, "tool", "setuptools", "packages", "find", "where"))
        for p in get(t, "tool", "poetry", "packages") or []:
            if isinstance(p, dict) and isinstance(p.get("from"), str):
                out.append(p["from"])
        for key in (("tool", "hatch", "build", "targets", "wheel", "packages"), ("tool", "hatch", "build", "packages")):
            for p in as_list(get(t, *key)):
                p = p.rstrip("/")
                if "/" in p:
                    out.append(p.rsplit("/", 1)[0])
        for key in (("tool", "hatch", "build", "targets", "wheel", "sources"), ("tool", "hatch", "build", "sources")):
            v = get(t, *key)
            out += list(v.keys()) if isinstance(v, dict) else as_list(v)
        module_root = get(t, "tool", "uv", "build-backend", "module-root")
        if isinstance(module_root, str):
            out.append(module_root)
        elif get(t, "build-system", "build-backend") == "uv_build":
            out.append("src")
        out += as_list(get(t, "tool", "pdm", "build", "package-dir"))
        out += as_list(get(t, "tool", "maturin", "python-source"))
    cfg = project / "setup.cfg"
    if cfg.is_file():
        cp = configparser.ConfigParser(interpolation=None)
        try:
            cp.read_string(cfg.read_text(encoding="utf-8"))
            pd = cp.get("options", "package_dir", fallback="")
            for line in pd.splitlines():
                line = line.strip()
                if line.startswith("="):
                    out.append(line[1:].strip())
            where = cp.get("options.packages.find", "where", fallback="").strip()
            if where:
                out.append(where)
        except Exception:
            pass
    sp = project / "setup.py"
    if sp.is_file():
        text = sp.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"package_dir\s*=\s*\{([^}]*)\}", text)
        if m:
            for k, v in re.findall(r"""['"]([^'"]*)['"]\s*:\s*['"]([^'"]+)['"]""", m.group(1)):
                if k == "":
                    out.append(v)
        out += re.findall(r"""find_(?:namespace_)?packages\(\s*(?:where\s*=\s*)?['"]([^'"]+)['"]""", text)
    return out


class Layout:
    def __init__(self, root: Path, py_dirs: set[Path]):
        self.root = root
        cands = set()
        for d in py_dirs:
            while True:
                if d in cands or inside(root, d) is None:
                    break
                cands.add(d)
                if d == root:
                    break
                d = d.parent
        self.projects: dict[Path, list[Path]] = {}
        self.manage: set[Path] = set()
        for c in sorted(cands):
            if is_project(c):
                roots: list[Path] = []
                for rel in configured_dirs(c):
                    p = inside(root, c / rel)
                    if p is not None and p.is_dir() and p not in roots:
                        roots.append(p)
                src = c / "src"
                if src.is_dir() and not (src / "__init__.py").is_file() and src not in roots:
                    roots.append(src)
                if c not in roots:
                    roots.append(c)
                self.projects[c] = roots
            if (c / "manage.py").is_file():
                self.manage.add(c)
        self.all: list[Path] = []
        for c in sorted(self.projects):
            for r in self.projects[c]:
                if r not in self.all:
                    self.all.append(r)
        for m in sorted(self.manage):
            if m not in self.all:
                self.all.append(m)
        if root not in self.all:
            self.all.append(root)
        self._cache: dict[Path, list[Path]] = {}

    def roots_for(self, d: Path) -> list[Path]:
        if d in self._cache:
            return self._cache[d]
        out: list[Path] = []
        c = d
        while True:
            if c in self.projects:
                out += self.projects[c]
                break
            if c == self.root or c.parent == c:
                break
            c = c.parent
        c = d
        while True:
            if c in self.manage:
                out.append(c)
                break
            if c == self.root or c.parent == c:
                break
            c = c.parent
        for r in self.all:
            if r not in out:
                out.append(r)
        self._cache[d] = out
        return out


def exact_file(d: Path, name: str) -> bool:
    try:
        return any(e.name == name and e.is_file(follow_symlinks=False) for e in os.scandir(d))
    except OSError:
        return False


def is_project(d: Path) -> bool:
    """`pyproject.toml` or `setup.cfg`, or a `setup.py` that is not a module of a
    package (`collectors/setup.py` next to `__init__.py` is code, not a project)."""
    if exact_file(d, "pyproject.toml") or exact_file(d, "setup.cfg"):
        return True
    return exact_file(d, "setup.py") and not exact_file(d, "__init__.py")


def has_code(d: Path, depth: int = 0) -> bool:
    """A `.py` file or a regular package in `d`, or in a nested namespace directory
    up to three levels down."""
    subdirs = []
    try:
        for e in os.scandir(d):
            if e.is_file() and e.name.endswith(".py"):
                return True
            if e.is_dir():
                if os.path.isfile(os.path.join(e.path, "__init__.py")):
                    return True
                subdirs.append(e)
    except OSError:
        return False
    return depth < 3 and any(
        e.name.isidentifier() and e.name not in NOT_MODULES and has_code(Path(e.path), depth + 1)
        for e in subdirs
    )


def find(name: str, path: list[Path]):
    """PathFinder.find_spec for one top-level or submodule name; namespace portions
    without code are dropped. Returns ('pkg'|'mod', file) | ('ns', [dirs]) | None."""
    if name in NOT_MODULES:
        return None
    spec = importlib.machinery.PathFinder.find_spec(name, [str(p) for p in path])
    if spec is None:
        return None
    if spec.origin and spec.origin not in ("namespace", None) and os.path.isfile(spec.origin):
        if not spec.origin.endswith(".py"):
            return None  # compiled extension or bytecode: not source in the repo
        if spec.submodule_search_locations is not None:
            return ("pkg", Path(spec.origin))
        return ("mod", Path(spec.origin))
    locs = [Path(p) for p in (spec.submodule_search_locations or [])]
    locs = [p for p in locs if has_code(p)]
    if not locs:
        # Every portion is empty: retry without them (an installed package would win).
        return None
    return ("ns", locs)


def search_locations(found) -> list[Path]:
    kind, v = found
    if kind == "pkg":
        return [v.parent]
    if kind == "ns":
        return v
    return []


class Oracle:
    def __init__(self, root: Path, layout: Layout):
        self.root = root
        self.layout = layout

    def rel(self, p: Path) -> str:
        return p.relative_to(self.root).as_posix()

    def module_id(self, found) -> str:
        kind, v = found
        return self.rel(v[0] if kind == "ns" else v)

    def basedir(self, file: Path) -> Path:
        d = file.parent
        while d != self.root and (d / "__init__.py").is_file():
            d = d.parent
        return d

    def anchor(self, file: Path) -> Path:
        d = file.parent
        roots = [r for r in self.layout.roots_for(d) if d == r or r in d.parents]
        return max(roots, key=lambda r: len(r.parts)) if roots else self.basedir(file)

    def walk(self, found, rest: list[str]):
        for seg in rest:
            if found[0] == "mod":
                return None
            found = find(seg, search_locations(found))
            if found is None:
                return None
        return found

    def resolve(self, file: Path, spec: str):
        """('repo', id) | ('stdlib', spec) | ('external', spec) | ('unresolved', why)."""
        if spec.startswith("."):
            anchor = self.anchor(file)
            pkg_parts = file.parent.relative_to(anchor).parts
            package = ".".join(pkg_parts)
            try:
                absolute = importlib.util.resolve_name(spec, package) if package else None
            except (ImportError, ValueError):
                absolute = None
            if absolute is None:
                return ("unresolved", "beyond top-level package")
            parts = absolute.split(".")
            top = find(parts[0], [anchor])
            if top is None:
                # The package directory itself may be a namespace without code of its own.
                d = anchor / parts[0]
                top = ("ns", [d]) if d.is_dir() else None
            if top is None:
                return ("unresolved", "missing")
            found = self.walk(top, parts[1:])
            return ("repo", self.module_id(found)) if found else ("unresolved", "missing")
        parts = spec.split(".")
        base = self.basedir(file)
        first = find(parts[0], [base])
        if first is not None and first[0] != "ns":
            found = self.walk(first, parts[1:])
            return ("repo", self.module_id(found)) if found else ("unresolved", "missing submodule")
        if parts[0] in STDLIB:
            return ("stdlib", spec)
        found = find(parts[0], [base] + self.layout.roots_for(file.parent))
        if found is None:
            return ("external", spec)
        found = self.walk(found, parts[1:])
        return ("repo", self.module_id(found)) if found else ("unresolved", "missing submodule")


# id(names dict) -> name -> (import spec, explicit `as` re-export), filled by bound_names.
IMPORT_SPECS: dict[int, dict[str, tuple[str, bool]]] = {}


def bound_names(body, out: dict[str, str], loops: bool = True):
    """Module-level names a body binds, with how: def, class, assign or import.
    With `loops=False`, names bound only inside module-level `for` loops are left out
    (Drift makes no symbols of a script's loop variables)."""
    for s in body:
        if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out.setdefault(s.name, "def")
        elif isinstance(s, ast.ClassDef):
            out.setdefault(s.name, "class")
        elif isinstance(s, ast.Assign):
            for t in s.targets:
                for n in ast.walk(t):
                    if isinstance(n, ast.Name):
                        out.setdefault(n.id, "assign")
        elif isinstance(s, (ast.AnnAssign, ast.AugAssign)) and isinstance(s.target, ast.Name):
            if not isinstance(s, ast.AnnAssign) or s.value is not None:
                out.setdefault(s.target.id, "assign")
        elif sys.version_info >= (3, 12) and isinstance(s, ast.TypeAlias):
            out.setdefault(s.name.id, "assign")
        elif isinstance(s, ast.Import):
            for a in s.names:
                out.setdefault(a.asname or a.name.split(".")[0], "import")
                IMPORT_SPECS.setdefault(id(out), {}).setdefault(a.asname or a.name.split(".")[0], (a.name if a.asname else a.name.split(".")[0], a.asname == a.name))
        elif isinstance(s, ast.ImportFrom):
            for a in s.names:
                if a.name != "*":
                    out.setdefault(a.asname or a.name, "import")
                    spec = "." * s.level + (s.module or "")
                    IMPORT_SPECS.setdefault(id(out), {}).setdefault(a.asname or a.name, (spec, a.asname == a.name))
        elif isinstance(s, ast.If):
            type_checking = (isinstance(s.test, ast.Name) and s.test.id == "TYPE_CHECKING") or (
                isinstance(s.test, ast.Attribute) and s.test.attr == "TYPE_CHECKING")
            if not (type_checking and not loops):
                bound_names(s.body, out, loops)
            bound_names(s.orelse, out, loops)
        elif isinstance(s, ast.Try) or (sys.version_info >= (3, 11) and isinstance(s, ast.TryStar)):
            bound_names(s.body, out, loops)
            for h in s.handlers:
                bound_names(h.body, out, loops)
            bound_names(s.orelse, out, loops)
            bound_names(s.finalbody, out, loops)
        elif isinstance(s, (ast.With, ast.AsyncWith)):
            bound_names(s.body, out, loops)
        elif isinstance(s, (ast.For, ast.AsyncFor)) and loops:
            for n in ast.walk(s.target):
                if isinstance(n, ast.Name):
                    out.setdefault(n.id, "assign")
            bound_names(s.body, out)


ABSTRACT_DECORATORS = {"abstractmethod", "abstractproperty", "abstractclassmethod", "abstractstaticmethod"}


def abc_names(tree) -> tuple[dict[str, str], set[str]]:
    """Module-level names bound to members of `abc` (`from abc import ABC as Base`), and
    names bound to the `abc` module itself (`import abc`)."""
    members, modules = {}, set()
    for st in tree.body:
        if isinstance(st, ast.ImportFrom) and st.module == "abc" and st.level == 0:
            for al in st.names:
                members[al.asname or al.name] = al.name
        elif isinstance(st, ast.Import):
            for al in st.names:
                if al.name == "abc":
                    modules.add(al.asname or "abc")
    return members, modules


def abstract_classes(tree) -> dict[str, bool]:
    """Module-level classes, and whether each is abstract by its own definition: it
    derives from `abc.ABC`, has `metaclass=abc.ABCMeta`, declares an `abc` abstract
    method, or is a Django/graphene model with `class Meta: abstract = True`."""
    members, modules = abc_names(tree)

    def abc_member(e) -> str | None:
        if isinstance(e, ast.Call):
            e = e.func
        if isinstance(e, ast.Name):
            return members.get(e.id)
        if isinstance(e, ast.Attribute) and isinstance(e.value, ast.Name) and e.value.id in modules:
            return e.attr
        return None

    out = {}
    for st in tree.body:
        if not isinstance(st, ast.ClassDef):
            continue
        base = any(abc_member(b) == "ABC" for b in st.bases)
        meta = any(k.arg == "metaclass" and abc_member(k.value) == "ABCMeta" for k in st.keywords)
        method = any(
            isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))
            and any(abc_member(d) in ABSTRACT_DECORATORS for d in m.decorator_list)
            for m in st.body
        )
        django = any(
            isinstance(m, ast.ClassDef) and m.name == "Meta"
            and any(
                isinstance(a, ast.Assign) and len(a.targets) == 1
                and isinstance(a.targets[0], ast.Name) and a.targets[0].id == "abstract"
                and isinstance(a.value, ast.Constant) and a.value.value is True
                for a in m.body
            )
            for m in st.body
        )
        out[st.name] = base or meta or method or django
    return out


def static_all(tree) -> list[str] | None:
    names: list[str] | None = None
    for s in tree.body:
        targets = []
        value = None
        if isinstance(s, ast.Assign):
            targets, value = s.targets, s.value
        elif isinstance(s, ast.AnnAssign) and s.value is not None:
            targets, value = [s.target], s.value
        elif isinstance(s, ast.AugAssign) and isinstance(s.target, ast.Name) and s.target.id == "__all__":
            if names is None or not isinstance(s.value, (ast.List, ast.Tuple)):
                return None
            for e in s.value.elts:
                if not (isinstance(e, ast.Constant) and isinstance(e.value, str)):
                    return None
                names.append(e.value)
            continue
        if any(isinstance(t, ast.Name) and t.id == "__all__" for t in targets):
            if not isinstance(value, (ast.List, ast.Tuple)):
                return None
            names = []
            for e in value.elts:
                if not (isinstance(e, ast.Constant) and isinstance(e.value, str)):
                    return None
                names.append(e.value)
    return names


def parse(path: Path):
    try:
        return ast.parse(path.read_bytes(), filename=str(path))
    except (SyntaxError, ValueError):
        return None


class Follower:
    """Follows `from X import name` to the name's origin, independently of Drift:
    module-level bindings in statement order (later ones win; `except` and `else`
    branches only fill names still unbound; `if TYPE_CHECKING:` bodies only when the
    name has no runtime binding), then submodules, then star imports (last first),
    then a module-level `__getattr__`."""

    def __init__(self, root: Path, oracle: "Oracle"):
        self.root = root
        self.oracle = oracle
        self.cache: dict[str, tuple | None] = {}

    def table(self, module_id: str):
        if module_id in self.cache:
            return self.cache[module_id]
        p = self.root / module_id
        tree = parse(p) if p.is_file() else None
        if tree is None:
            self.cache[module_id] = None
            return None
        binds: dict[str, tuple] = {}
        stars: list[str] = []
        state = {"getattr": False}

        def bind(n, b, weak):
            if weak and n in binds:
                return
            binds[n] = b

        def walk(body, weak, type_only):
            for st in body:
                if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    if st.name == "__getattr__":
                        state["getattr"] = True
                    bind(st.name, ("local",), weak or type_only)
                elif isinstance(st, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                    targets = st.targets if isinstance(st, ast.Assign) else [st.target]
                    if isinstance(st, ast.AnnAssign) and st.value is None:
                        continue
                    for t in targets:
                        for n in ast.walk(t):
                            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store):
                                bind(n.id, ("local",), weak or type_only)
                elif sys.version_info >= (3, 12) and isinstance(st, ast.TypeAlias):
                    bind(st.name.id, ("local",), weak or type_only)
                elif isinstance(st, ast.Import):
                    for a in st.names:
                        if a.asname:
                            bind(a.asname, ("module", a.name), weak or type_only)
                        else:
                            top = a.name.split(".")[0]
                            bind(top, ("module", top), weak or type_only)
                elif isinstance(st, ast.ImportFrom):
                    spec = "." * st.level + (st.module or "")
                    for a in st.names:
                        if a.name == "*":
                            if not type_only:
                                stars.append(spec)
                        else:
                            bind(a.asname or a.name, ("from", spec, a.name), weak or type_only)
                elif isinstance(st, ast.If):
                    tc = (isinstance(st.test, ast.Name) and st.test.id == "TYPE_CHECKING") or (
                        isinstance(st.test, ast.Attribute) and st.test.attr == "TYPE_CHECKING")
                    walk(st.body, weak, type_only or tc)
                    walk(st.orelse, weak or not tc, type_only)
                elif isinstance(st, ast.Try) or (sys.version_info >= (3, 11) and isinstance(st, ast.TryStar)):
                    walk(st.body, weak, type_only)
                    for h in st.handlers:
                        walk(h.body, True, type_only)
                    walk(st.orelse, weak, type_only)
                    walk(st.finalbody, weak, type_only)
                elif isinstance(st, (ast.With, ast.AsyncWith)):
                    walk(st.body, weak, type_only)
                elif isinstance(st, (ast.For, ast.AsyncFor, ast.While)):
                    if isinstance(st, (ast.For, ast.AsyncFor)):
                        for n in ast.walk(st.target):
                            if isinstance(n, ast.Name):
                                bind(n.id, ("local",), True)
                    walk(st.body, True, type_only)

        walk(tree.body, False, False)
        all_ = static_all(tree)
        self.cache[module_id] = (binds, stars, state["getattr"], all_)
        return self.cache[module_id]

    def submodule(self, module_id: str, name: str):
        p = self.root / module_id
        loc = p.parent if module_id.endswith("__init__.py") else p if p.is_dir() else None
        if loc is None:
            return None
        f = find(name, [loc])
        return self.oracle.module_id(f) if f else None

    def exports(self, module_id: str, name: str, depth: int) -> bool:
        t = self.table(module_id)
        if t is None or depth > 32:
            return False
        binds, stars, _, all_ = t
        if all_ is not None:
            return name in all_
        if name.startswith("_"):
            return False
        if name in binds:
            return True
        for spec in stars:
            k, v = self.oracle.resolve(self.root / module_id, spec)
            if k == "repo" and self.exports(v, name, depth + 1):
                return True
        return False

    def origin(self, module_id: str, name: str, depth: int = 0, seen=None):
        """('attr', 'file#name', defined_here) | ('module', id) | ('external', spec) |
        ('unresolved', spec) | ('dynamic', why) | ('missing', where)."""
        seen = seen if seen is not None else set()
        if depth > 32 or (module_id, name) in seen:
            return ("dynamic", "cycle")
        seen.add((module_id, name))
        t = self.table(module_id)
        file = self.root / module_id
        if t is None:
            sub = self.submodule(module_id, name)
            return ("module", sub) if sub else ("missing", f"{module_id}#{name}")
        binds, stars, has_getattr, _ = t
        b = binds.get(name)
        if b is not None and b[0] == "local":
            return ("attr", f"{module_id}#{name}", depth == 0)
        if b is not None and b[0] == "module":
            k, v = self.oracle.resolve(file, b[1])
            return ("module", v) if k == "repo" else ("unresolved", b[1]) if k == "unresolved" else ("external", b[1])
        if b is not None:
            _, spec, n = b
            k, v = self.oracle.resolve(file, spec)
            if k == "unresolved":
                return ("unresolved", spec)
            if k != "repo":
                return ("external", spec)
            if v == module_id:  # `from . import sub` inside the package itself
                sub = self.submodule(module_id, n)
                return ("module", sub) if sub else ("missing", f"{module_id}#{n}")
            got = self.origin(v, n, depth + 1, seen)
            return (got[0], got[1], False) if got[0] == "attr" else got
        sub = self.submodule(module_id, name)
        if sub:
            return ("module", sub)
        for spec in reversed(stars):
            k, v = self.oracle.resolve(file, spec)
            if k != "repo":
                return ("dynamic", f"star import of {spec}")
            if self.exports(v, name, depth + 1):
                got = self.origin(v, name, depth + 1, seen)
                return (got[0], got[1], False) if got[0] == "attr" else got
        if has_getattr:
            return ("dynamic", f"{module_id}.__getattr__")
        return ("missing", f"{module_id}#{name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo")
    ap.add_argument("imports")
    ap.add_argument("facts")
    ap.add_argument("--samples", type=int, default=400)
    ap.add_argument("--json")
    a = ap.parse_args()
    root = Path(a.repo).resolve()
    rows = [json.loads(l) for l in open(a.imports, encoding="utf-8") if l.strip()]
    facts = json.load(open(a.facts, encoding="utf-8"))
    py_files = [f for f in facts["files"] if f["lang"] == "py"]
    py_dirs = {(root / f["path"]).parent for f in py_files}
    py_dirs |= {(root / s["path"]).parent for s in facts.get("skipped", []) if s["path"].endswith((".py", ".pyi"))}
    layout = Layout(root, py_dirs)
    oracle = Oracle(root, layout)

    cats: dict[str, int] = {}
    examples: dict[str, list] = {}

    def bump(cat, row, expected):
        cats[cat] = cats.get(cat, 0) + 1
        ex = examples.setdefault(cat, [])
        if len(ex) < 8:
            ex.append({"file": row["file"], "spec": row["spec"], "drift": row["module"], "python": expected})

    follower = Follower(root, oracle)

    for row in rows:
        file = root / row["file"]
        d = row["module"]
        dkind = "stdlib" if d.startswith("pkg:python:") else "external" if d.startswith("pkg:") else "unresolved" if d.startswith("unresolved:") else "repo"
        if row["kind"] != "name":
            kind, val = oracle.resolve(file, row["spec"])
            if kind == "repo":
                if dkind == "repo" and d == val:
                    bump("agree", row, val)
                elif dkind == "repo":
                    bump("DISAGREE", row, val)
                else:
                    bump("GAP_python_resolves_in_repo", row, val)
            elif kind in ("stdlib", "external"):
                if dkind == kind:
                    bump(f"agree_{kind}", row, val)
                elif dkind in ("stdlib", "external"):
                    bump("DISAGREE_stdlib_vs_external", row, f"{kind}:{val}")
                elif dkind == "repo":
                    bump("DISAGREE_drift_in_repo", row, f"{kind}:{val}")
                else:
                    bump("GAP_drift_unresolved_python_external", row, f"{kind}:{val}")
            else:
                if dkind == "unresolved":
                    bump("agree_unresolved", row, val)
                elif dkind == "repo":
                    bump("DISAGREE_drift_in_repo", row, f"unresolved:{val}")
                else:
                    bump("DISAGREE_drift_external_python_unresolved", row, f"unresolved:{val}")
            continue
        # `from X import name`: follow the name to its origin with CPython's `ast`.
        spec, name = row["spec"].rsplit(":", 1)
        kind, val = oracle.resolve(file, spec)
        if kind != "repo":
            bump("name_external", row, None)  # X is installed code a checkout does not have
            continue
        want = follower.origin(val, name)
        d_mod = d if "#" not in d else None
        if want[0] == "attr":
            ok = d == want[1]
            bump(("name_agree_attribute" if want[2] else "name_agree_reexport") if ok else "DISAGREE_name_origin", row, want[1])
        elif want[0] == "module":
            bump("name_agree_submodule" if d_mod == want[1] else "DISAGREE_name_submodule", row, want[1])
        elif want[0] == "external":
            bump("name_agree_external_origin" if d.startswith("pkg:") else "DISAGREE_name_external_origin", row, want[1])
        elif want[0] == "unresolved":
            bump("name_agree_unresolved" if d.startswith("unresolved:") else "DISAGREE_name_unresolved", row, want[1])
        elif want[0] == "dynamic":
            bump("name_unjudged_dynamic", row, want[1])  # module `__getattr__` or an external star import
        else:
            # Neither bound in X nor a submodule: CPython raises ImportError.
            bump("GAP_name_missing", row, want[1])

    # ------------------------------------------------------------ module-level names
    paths = sorted(f["path"] for f in py_files)
    step = max(1, len(paths) // max(1, a.samples))
    sample = paths[::step][: a.samples]
    by_path = {f["path"]: f for f in py_files}
    sym = {"files": 0, "python_names": 0, "matched": 0, "missing": 0, "extra": 0,
           "exports_python": 0, "exports_matched": 0, "parse_disagree": 0,
           "classes": 0, "abstract_python": 0, "abstract_disagree": 0}
    missing_ex, extra_ex, exp_ex, parse_ex, abstract_ex = [], [], [], [], []
    for p in sample:
        f = by_path[p]
        tree = parse(root / p)
        if (tree is not None) != f["parse_ok"]:
            sym["parse_disagree"] += 1
            if len(parse_ex) < 8:
                parse_ex.append(p)
        if tree is None:
            continue
        sym["files"] += 1
        names: dict[str, str] = {}
        bound_names(tree.body, names, loops=False)
        local = {n for n, k in names.items() if k != "import" and not (n.startswith("__") and n.endswith("__"))}
        drift_syms = {s["name"] for s in f["symbols"] if s["kind"] != "module"}
        # Names defined locally in any branch (`try: import x` / `except: class x`) may be symbols too.
        anywhere = {n.name for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
        anywhere |= {n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)}
        for n in sorted(local):
            sym["python_names"] += 1
            if n in drift_syms:
                sym["matched"] += 1
            else:
                sym["missing"] += 1
                if len(missing_ex) < 12:
                    missing_ex.append(f"{p} :: {n}")
        for n in sorted(drift_syms - local - anywhere):
            sym["extra"] += 1
            if len(extra_ex) < 12:
                extra_ex.append(f"{p} :: {n}")
        # Abstract classes: CPython's `ast` against Drift's `abstract` trait. A class bound
        # twice (`try`/`except` variants) is judged by its last definition on both sides.
        classes = {s["name"]: s for s in f["symbols"] if s["kind"] == "class"}
        for n, abstract in sorted(abstract_classes(tree).items()):
            if n not in classes:
                continue
            sym["classes"] += 1
            sym["abstract_python"] += abstract
            if abstract != ("abstract" in classes[n].get("traits", [])):
                sym["abstract_disagree"] += 1
                if len(abstract_ex) < 12:
                    abstract_ex.append(f"{p} :: {n} (python {'abstract' if abstract else 'concrete'})")
        # Exports: `__all__` when static, else public names (imports only in `__init__.py`).
        all_ = static_all(tree)
        is_init = p.endswith("__init__.py")
        if all_ is not None:
            expected = set(all_)
        else:
            # Imports are re-exported by a package `__init__` when they come from the repo,
            # and anywhere with the explicit `import x as x` form.
            specs = IMPORT_SPECS.get(id(names), {})

            def reexported(n):
                spec, explicit = specs.get(n, ("", False))
                return explicit or (is_init and oracle.resolve(root / p, spec)[0] == "repo")

            expected = {n for n, k in names.items() if not n.startswith("_") and (k != "import" or reexported(n))}
        drift_exports = {e["name"] for e in f["exports"] if e["name"] != "*"}
        for n in expected:
            sym["exports_python"] += 1
            if n in drift_exports:
                sym["exports_matched"] += 1
            elif len(exp_ex) < 12:
                exp_ex.append(f"{p} :: {n}")

    report = {
        "imports": {"total": len(rows), "categories": dict(sorted(cats.items())), "examples": examples},
        "symbols": sym,
        "symbol_examples": {"missing": missing_ex, "extra": extra_ex, "exports_missing": exp_ex, "parse_disagree": parse_ex,
                            "abstract_disagree": abstract_ex},
    }
    print(f"{root.name}: {len(rows)} import rows")
    for k, v in sorted(cats.items()):
        print(f"  {k:<40} {v}")
    print(f"  module-level names: {sym['matched']}/{sym['python_names']} matched, {sym['extra']} extra; "
          f"exports {sym['exports_matched']}/{sym['exports_python']}; parse disagreements {sym['parse_disagree']}")
    print(f"  classes: {sym['classes']}, {sym['abstract_python']} abstract; "
          f"abstract disagreements {sym['abstract_disagree']}")
    for e in abstract_ex[:4]:
        print(f"    ABSTRACT_DISAGREE: {e}")
    for k in sorted(examples):
        if k.startswith(("DISAGREE", "GAP")):
            for e in examples[k][:4]:
                print(f"    {k}: {e}")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2, sort_keys=True)


if __name__ == "__main__":
    main()
