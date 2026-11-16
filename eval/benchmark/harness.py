#!/usr/bin/env python3
"""Agent benchmark harness: runs every (task, arm, run) in a clean working copy.

    python3 -I eval/benchmark/harness.py freeze --config CONFIG.json [--tests]
    python3 -I eval/benchmark/harness.py plan   --config CONFIG.json
    python3 -I eval/benchmark/harness.py run    --config CONFIG.json [--dry-run] [--limit N] [--keep-workdirs]
    python3 -I eval/benchmark/harness.py status --config CONFIG.json

The harness knows nothing about the agent: it fills one command template from
the config and runs it with a timeout. It knows nothing about the model either:
the model identifier is a config value the operator supplies, recorded in the
manifest and offered to the template as {model}. See README.md for the config.

For each (task, arm, run), in a seeded random order, one at a time:
  1. a fresh working copy holding the task's base commit and its history only
     (fetched by commit id from the local mirror; the fix is not reachable);
  2. the task's setup_command, if any;
  3. arms/<arm>.sh prepares the arm; the result is committed as "Project setup"
     with a fixed identity and date, in every arm (an empty commit for "none");
  4. the agent command, in its own process group, with a per-run HOME and
     TMPDIR, a minimal environment, the timeout and the budget;
  5. capture: the agent's diff (setup commit to final tree, untracked files
     included, ignored files not), the full diff from the base commit, the
     transcript the agent wrote, stdout, stderr, wall time, exit status;
  6. the task's test command, if any, with its own timeout;
  7. the working copy and HOME are deleted (unless --keep-workdirs).

--dry-run executes all of this except the agent command and the Drift
commands: the agent is dryrun/fake_agent.py (a trivial edit) and drift is
dryrun/fake_drift.py. Nothing in a dry run calls a model or the network.
"""

import argparse
import json
import os
import platform
import shutil
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import benchlib as bl  # noqa: E402

HARNESS_VERSION = 1
ARMS = ("none", "plain", "agents-md", "hooks")
STATUSES = ("ok", "agent-error", "timeout", "budget", "harness-error")
TEMPLATE_KEYS = ("workdir", "prompt_file", "transcript", "usage", "run_dir", "timeout_s", "budget", "model", "home")
COMMIT_ENV = {
    "GIT_AUTHOR_NAME": "benchmark", "GIT_AUTHOR_EMAIL": "benchmark@localhost.invalid",
    "GIT_COMMITTER_NAME": "benchmark", "GIT_COMMITTER_EMAIL": "benchmark@localhost.invalid",
    "GIT_AUTHOR_DATE": "2000-01-01T00:00:00Z", "GIT_COMMITTER_DATE": "2000-01-01T00:00:00Z",
}


class HarnessError(Exception):
    pass


# ---------------------------------------------------------------- config

def load_config(path, dry_run=False):
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    base = os.path.dirname(os.path.abspath(path))

    def absp(p):
        return p if p is None or os.path.isabs(p) else os.path.normpath(os.path.join(base, p))

    cfg.setdefault("arms", list(ARMS))
    cfg.setdefault("runs_per_arm", 3)
    cfg.setdefault("instructions_file", "AGENTS.md")
    cfg.setdefault("accept", {"rule": "default-tier", "mode": "advise", "lists": {}})
    cfg.setdefault("hooks", {"files": [], "with_agents_md": True})
    cfg.setdefault("drift_on_path", {"none": False, "plain": False, "agents-md": False, "hooks": True})
    cfg.setdefault("tests", {"enabled": True, "timeout_s": 900})
    cfg.setdefault("history_depth", None)
    cfg.setdefault("total_cost_limit", None)
    cfg.setdefault("retry_harness_errors", 1)
    agent = cfg.setdefault("agent", {})
    agent.setdefault("timeout_s", 1800)
    agent.setdefault("budget", "")
    agent.setdefault("budget_exit_codes", [])
    agent.setdefault("env", {})
    agent.setdefault("pass_env", [])
    agent.setdefault("path", ["/usr/local/bin", "/usr/bin", "/bin"])
    agent.setdefault("home_template", None)
    for k in ("tasks_dir", "runs_root", "work_root", "plain_instructions_dir"):
        cfg[k] = absp(cfg.get(k))
    cfg["mirrors"] = {r: absp(p) for r, p in cfg.get("mirrors", {}).items()}
    agent["home_template"] = absp(agent["home_template"])
    cfg["accept"]["lists"] = {r: absp(p) for r, p in cfg["accept"].get("lists", {}).items()}
    cfg["hooks"]["files"] = [{"src": absp(h["src"]), "dest": h["dest"]} for h in cfg["hooks"].get("files", [])]
    drift = cfg.setdefault("drift", {})
    drift["binary"] = absp(drift.get("binary"))

    for a in cfg["arms"]:
        if a not in ARMS:
            raise SystemExit("unknown arm %r (arms are %s)" % (a, ", ".join(ARMS)))
    if not cfg.get("seed"):
        raise SystemExit("config needs a seed")
    if not cfg.get("runs_root"):
        raise SystemExit("config needs runs_root")
    # Working copies and per-run HOMEs live apart from the results. The harness
    # cannot stop a process from reading a directory its user can read: full
    # isolation from other runs' results is the operator's sandbox (README).
    cfg["work_root"] = cfg.get("work_root") or os.path.join(cfg["runs_root"], "work")

    if dry_run:
        py = sys.executable
        agent["command"] = [py, "-I", os.path.join(HERE, "dryrun", "fake_agent.py"), "--workdir", "{workdir}",
                            "--prompt-file", "{prompt_file}", "--transcript", "{transcript}", "--usage", "{usage}"]
        agent["version_command"] = [py, "-I", os.path.join(HERE, "dryrun", "fake_agent.py"), "--version"]
        agent["budget_exit_codes"] = [75]
        agent["pass_env"] = []
        drift["binary"] = os.path.join(HERE, "dryrun", "fake_drift.py")
        cfg["model"] = cfg.get("model") or "dry-run"
        if not cfg["hooks"]["files"]:
            src = os.path.normpath(os.path.join(HERE, "..", "..", "integrations", "claude-code", "hooks", "hooks.json"))
            cfg["hooks"]["files"] = [{"src": src, "dest": ".agent/hooks.json"}]
        cfg["dry_run"] = True
    else:
        cfg["dry_run"] = False
        if not agent.get("command"):
            raise SystemExit("config needs agent.command (a list; placeholders %s)" % ", ".join("{%s}" % k for k in TEMPLATE_KEYS))
        if not cfg.get("model"):
            raise SystemExit("config needs model: the model identifier the operator runs, recorded in the manifest")
        if any(a in cfg["arms"] for a in ("agents-md", "hooks")) and not drift.get("binary"):
            raise SystemExit("config needs drift.binary for the Drift arms")
    return cfg


def load_tasks(cfg):
    tdir = os.path.join(cfg["tasks_dir"], "tasks")
    with open(os.path.join(HERE, "tasks", "schema.json"), encoding="utf-8") as f:
        schema = json.load(f)
    tasks = []
    for name in sorted(os.listdir(tdir)):
        if not name.endswith(".json") or name == "schema.json":
            continue
        with open(os.path.join(tdir, name), encoding="utf-8") as f:
            t = json.load(f)
        errs = bl.validate(t, schema)
        if errs:
            raise SystemExit("task %s does not match tasks/schema.json: %s" % (name, "; ".join(errs[:5])))
        t["_path"] = os.path.join(tdir, name)
        tasks.append(t)
    if not tasks:
        raise SystemExit("no tasks in " + tdir)
    return tasks


def run_order(cfg, tasks):
    items = [(t["id"], arm, r) for t in tasks for arm in cfg["arms"] for r in range(1, cfg["runs_per_arm"] + 1)]
    items.sort(key=lambda it: bl.stable_key(cfg["seed"], "order", *it))
    return items


def run_id(cfg, task_id, arm, r):
    # Opaque: the working copy's path must not tell the agent (or a grader) the arm.
    return bl.stable_key(cfg["seed"], "run", task_id, arm, r)[:16]


# ---------------------------------------------------------------- processes

def git(args, cwd=None, env=None, check=True, capture=True):
    e = dict(os.environ)
    e.update({"GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_NOSYSTEM": "1", "LC_ALL": "C"})
    if env:
        e.update(env)
    p = subprocess.run(["git"] + args, cwd=cwd, env=e, stdout=subprocess.PIPE if capture else None,
                       stderr=subprocess.PIPE if capture else None)
    if check and p.returncode != 0:
        raise HarnessError("git %s failed: %s" % (" ".join(args), (p.stderr or b"").decode("utf-8", "replace").strip()))
    return (p.stdout or b"").decode("utf-8", "replace")


def run_limited(cmd, cwd, env, timeout_s, stdout_path, stderr_path, shell=False):
    """Run cmd in its own process group; kill the group on timeout.
    Returns (exit_code or None, timed_out, wall_seconds)."""
    start = time.monotonic()
    with open(stdout_path, "wb") as out, open(stderr_path, "wb") as err:
        p = subprocess.Popen(cmd, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                             start_new_session=True, shell=shell)
        try:
            code = p.wait(timeout=timeout_s)
            timed_out = False
        except subprocess.TimeoutExpired:
            timed_out = True
            for sig, wait in ((signal.SIGTERM, 10), (signal.SIGKILL, 10)):
                try:
                    os.killpg(p.pid, sig)
                except ProcessLookupError:
                    break
                try:
                    p.wait(timeout=wait)
                    break
                except subprocess.TimeoutExpired:
                    continue
            code = p.returncode
    return code, timed_out, round(time.monotonic() - start, 3)


def version_of(cmd):
    try:
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60, stdin=subprocess.DEVNULL)
        return p.stdout.decode("utf-8", "replace").strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return "unavailable: %s" % e


def mirror_digest(mirror):
    return bl.stable_key("refs", git(["for-each-ref", "--format=%(objectname) %(refname)"], cwd=mirror))


# ---------------------------------------------------------------- working copy

def make_working_copy(cfg, task, work, commit=None):
    commit = commit or task["base_commit"]
    mirror = cfg["mirrors"].get(task["repository"])
    if not mirror or not os.path.isdir(mirror):
        raise HarnessError("no local mirror for %s" % task["repository"])
    if os.path.exists(work):
        raise HarnessError("working copy path already exists: %s" % work)
    os.makedirs(work)
    git(["init", "-q", "-b", task.get("base_branch") or "main"], cwd=work)
    fetch = ["fetch", "-q", "--no-tags"]
    if cfg.get("history_depth"):
        fetch += ["--depth", str(int(cfg["history_depth"]))]
    git(fetch + [mirror, commit], cwd=work)
    git(["reset", "-q", "--hard", "FETCH_HEAD"], cwd=work)
    for leftover in ("FETCH_HEAD", "ORIG_HEAD"):
        p = os.path.join(work, ".git", leftover)
        if os.path.exists(p):
            os.remove(p)
    git(["reflog", "expire", "--expire=now", "--all"], cwd=work)
    git(["config", "user.name", COMMIT_ENV["GIT_AUTHOR_NAME"]], cwd=work)
    git(["config", "user.email", COMMIT_ENV["GIT_AUTHOR_EMAIL"]], cwd=work)
    head = git(["rev-parse", "HEAD"], cwd=work).strip()
    if head != commit:
        raise HarnessError("working copy is at %s, not %s" % (head, commit))
    if git(["remote"], cwd=work).strip():
        raise HarnessError("working copy has a remote")


def assert_fix_hidden(task, work):
    p = subprocess.run(["git", "cat-file", "-e", task["merge_commit"] + "^{commit}"], cwd=work,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if p.returncode == 0:
        raise HarnessError("the merge commit is reachable in the working copy")


def snapshot_tree(work, index_path):
    """Tree of the working copy as it stands (untracked included, ignored not),
    built in a throwaway index so HEAD and the agent's own index are untouched."""
    env = {"GIT_INDEX_FILE": index_path}
    if os.path.exists(index_path):
        os.remove(index_path)
    git(["read-tree", "--empty"], cwd=work, env=env)
    git(["add", "-A", "--", "."], cwd=work, env=env)
    tree = git(["write-tree"], cwd=work, env=env).strip()
    os.remove(index_path)
    return tree


def diff_trees(work, a, b, path):
    out = git(["diff", "--binary", "--no-color", "--no-ext-diff", "--no-renames", "--full-index", a, b], cwd=work)
    with open(path, "w", encoding="utf-8") as f:
        f.write(out)
    names = git(["diff", "--name-only", "--no-renames", a, b], cwd=work).split("\n")
    stat = git(["diff", "--numstat", "--no-renames", a, b], cwd=work)
    added = deleted = 0
    for line in stat.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            added += int(parts[0])
            deleted += int(parts[1])
    return sorted(n for n in names if n), added, deleted


# ---------------------------------------------------------------- environment

def agent_env(cfg, arm, home, tmp, bin_dir):
    path = list(cfg["agent"]["path"])
    if cfg["drift_on_path"].get(arm, False):
        path = [bin_dir] + path
    env = {
        "PATH": os.pathsep.join(path),
        "HOME": home,
        "TMPDIR": tmp,
        "XDG_CONFIG_HOME": os.path.join(home, ".config"),
        "XDG_CACHE_HOME": os.path.join(home, ".cache"),
        "XDG_DATA_HOME": os.path.join(home, ".local", "share"),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
    }
    for name in cfg["agent"]["pass_env"]:
        if name in os.environ:
            env[name] = os.environ[name]
    for k, v in cfg["agent"]["env"].items():
        env[k] = str(v)
    for k in env:
        if k.startswith("BENCH_"):
            raise HarnessError("BENCH_ variables are for arm scripts and never reach the agent: " + k)
    found = shutil.which("drift", path=env["PATH"])
    if cfg["drift_on_path"].get(arm, False):
        if not found:
            raise HarnessError("drift is not on the agent's PATH in arm %s" % arm)
    elif found:
        raise HarnessError("drift is on the agent's PATH (%s) in arm %s, which must not have it" % (found, arm))
    return env


def plain_env(home, tmp):
    """Environment for setup and test commands: the operator's PATH, the run's
    HOME and TMPDIR, and nothing else (no secrets the agent was passed)."""
    os.makedirs(tmp, exist_ok=True)
    return {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": home, "TMPDIR": tmp,
            "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "CI": "1"}


def arm_env(cfg, task, arm, run_dir):
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/tmp"),
        "LANG": "C.UTF-8",
        "BENCH_DRIFT": cfg["drift"].get("binary") or "/nonexistent/drift",
        "BENCH_PYTHON": sys.executable,
        "BENCH_ARMS_DIR": os.path.join(HERE, "arms"),
        "BENCH_INSTRUCTIONS_FILE": cfg["instructions_file"],
        "BENCH_ACCEPT_RULE": cfg["accept"].get("rule", "default-tier"),
        "BENCH_ACCEPT_MODE": cfg["accept"].get("mode", "advise"),
        "BENCH_ACCEPT_LIST": cfg["accept"]["lists"].get(task["repository"], "") or "",
        "BENCH_HOOK_FILES": "\n".join("%s=>%s" % (h["src"], h["dest"]) for h in cfg["hooks"]["files"]),
        "BENCH_HOOKS_WITH_AGENTS_MD": "1" if cfg["hooks"].get("with_agents_md", True) else "0",
    }
    if arm == "plain":
        d = cfg.get("plain_instructions_dir")
        src = os.path.join(d, task["id"] + ".md") if d else ""
        if cfg["dry_run"] and (not src or not os.path.exists(src)):
            src = os.path.join(run_dir, "plain-instructions.md")
            with open(src, "w", encoding="utf-8") as f:
                f.write("# Project notes (dry run)\n\nRun the tests before finishing.\n")
        env["BENCH_PLAIN_SOURCE"] = src
    return env


def fill(template, values):
    out = []
    for part in template:
        try:
            out.append(part.format(**values))
        except KeyError as e:
            raise HarnessError("unknown placeholder %s in agent command; known: %s" % (e, ", ".join(TEMPLATE_KEYS)))
    return out


# ---------------------------------------------------------------- one run

def mentions_other_runs(path, results_dir, own_id):
    """Run ids of other runs whose results the transcript names: a sign the
    agent looked outside its working copy (checked after the run, not prevented)."""
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    import re as _re
    found = set(_re.findall(_re.escape(results_dir + os.sep) + r"([0-9a-f]{16})", text))
    return sorted(found - {own_id})


def fresh_attempt_dir(attempt_dir):
    """Create the attempt directory empty. One left by an interrupted run (Ctrl-C, or an
    error before result.json) is moved aside to <dir>.stale-N, never reused: its
    transcript, usage and arm.log are that run's, and reading them would count its cost
    and its transcript hash as this attempt's."""
    if os.path.lexists(attempt_dir):
        n = 1
        while os.path.lexists("%s.stale-%d" % (attempt_dir, n)):
            n += 1
        os.rename(attempt_dir, "%s.stale-%d" % (attempt_dir, n))
    os.makedirs(attempt_dir)


def one_run(cfg, task, arm, r, attempt_dir, keep):
    rid = os.path.basename(os.path.dirname(attempt_dir))
    root = cfg["runs_root"]
    work = os.path.join(cfg["work_root"], rid)
    home = os.path.join(cfg["work_root"] + ".home", rid)
    tmp = os.path.join(home, "tmp")
    bin_dir = os.path.join(cfg["work_root"] + ".bin", rid)
    fresh_attempt_dir(attempt_dir)
    res = {"task": task["id"], "arm": arm, "run": r, "run_id": rid, "status": None, "exit_code": None,
           "timed_out": False, "wall_s": None, "error": None}
    mirror = cfg["mirrors"].get(task["repository"])
    try:
        for d in (work, home, bin_dir):
            if os.path.exists(d):
                shutil.rmtree(d)
        before = mirror_digest(mirror) if mirror and os.path.isdir(mirror) else None
        make_working_copy(cfg, task, work)
        assert_fix_hidden(task, work)
        if task.get("setup_command"):
            code, to, wall = run_limited(task["setup_command"], work, plain_env(home, tmp), cfg["tests"]["timeout_s"],
                                         os.path.join(attempt_dir, "setup.out"), os.path.join(attempt_dir, "setup.err"), shell=True)
            if code != 0 or to:
                raise HarnessError("setup_command failed (exit %s, timeout %s)" % (code, to))
        # prepare the arm
        script = os.path.join(HERE, "arms", arm + ".sh")
        p = subprocess.run(["bash", script, work, attempt_dir], env=arm_env(cfg, task, arm, attempt_dir),
                           stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        with open(os.path.join(attempt_dir, "arm.log"), "ab") as f:
            f.write(p.stdout)
        if p.returncode != 0:
            raise HarnessError("arms/%s.sh exited %d (see arm.log)" % (arm, p.returncode))
        git(["add", "-A"], cwd=work)
        git(["commit", "-q", "--allow-empty", "--no-verify", "-m", "Project setup"], cwd=work, env=COMMIT_ENV)
        setup_commit = git(["rev-parse", "HEAD"], cwd=work).strip()
        res["setup_commit"] = setup_commit
        pol = os.path.join(work, ".drift", "conventions.yaml")
        res["policy_sha256"] = bl.sha256_file(pol) if os.path.exists(pol) else None
        res["setup_files"], _, _ = diff_trees(work, task["base_commit"], setup_commit, os.path.join(attempt_dir, "setup.diff"))
        # per-run HOME, TMPDIR and the drift link for arms that get drift on PATH
        os.makedirs(tmp, exist_ok=True)
        if cfg["agent"]["home_template"]:
            shutil.copytree(cfg["agent"]["home_template"], home, dirs_exist_ok=True, symlinks=True)
        os.makedirs(bin_dir)
        if cfg["drift"].get("binary"):
            os.symlink(cfg["drift"]["binary"], os.path.join(bin_dir, "drift"))
        env = agent_env(cfg, arm, home, tmp, bin_dir)
        prompt_file = os.path.join(attempt_dir, "prompt.txt")
        with open(prompt_file, "w", encoding="utf-8") as f:
            f.write(task["prompt"])
        transcript = os.path.join(attempt_dir, "transcript.jsonl")
        usage = os.path.join(attempt_dir, "usage.json")
        values = {"workdir": work, "prompt_file": prompt_file, "transcript": transcript, "usage": usage,
                  "run_dir": attempt_dir, "timeout_s": cfg["agent"]["timeout_s"], "budget": cfg["agent"]["budget"],
                  "model": cfg["model"], "home": home}
        cmd = fill(cfg["agent"]["command"], values)
        code, timed_out, wall = run_limited(cmd, work, env, cfg["agent"]["timeout_s"],
                                            os.path.join(attempt_dir, "agent.stdout"), os.path.join(attempt_dir, "agent.stderr"))
        res.update({"exit_code": code, "timed_out": timed_out, "wall_s": wall})
        if timed_out:
            res["status"] = "timeout"
        elif code in cfg["agent"]["budget_exit_codes"]:
            res["status"] = "budget"
        elif code != 0:
            res["status"] = "agent-error"
        else:
            res["status"] = "ok"
        # capture
        final_tree = snapshot_tree(work, os.path.join(attempt_dir, "capture.index"))
        res["final_tree"] = final_tree
        res["changed_files"], res["added"], res["deleted"] = diff_trees(work, setup_commit, final_tree, os.path.join(attempt_dir, "agent.diff"))
        diff_trees(work, task["base_commit"], final_tree, os.path.join(attempt_dir, "full.diff"))
        res["transcript_sha256"] = bl.sha256_file(transcript) if os.path.exists(transcript) else None
        res["transcript_names_other_runs"] = mentions_other_runs(transcript, os.path.join(root, "runs"), rid)
        if os.path.exists(usage):
            try:
                with open(usage, encoding="utf-8") as f:
                    res["usage"] = json.load(f)
            except ValueError:
                res["usage"] = {"unreadable": True}
        # tests
        if task.get("test_command") and cfg["tests"].get("enabled", True):
            tcode, tto, twall = run_limited(task["test_command"], work, plain_env(home, tmp), cfg["tests"]["timeout_s"],
                                            os.path.join(attempt_dir, "tests.out"), os.path.join(attempt_dir, "tests.err"), shell=True)
            res["tests"] = {"command": task["test_command"], "exit_code": tcode, "timed_out": tto, "wall_s": twall}
        else:
            res["tests"] = None
        after = mirror_digest(mirror) if before else None
        if before != after:
            raise HarnessError("the local mirror changed during the run")
    except HarnessError as e:
        res["status"] = "harness-error"
        res["error"] = str(e)
    finally:
        if not keep:
            for d in (work, home, bin_dir):
                if os.path.exists(d):
                    shutil.rmtree(d, ignore_errors=True)
    bl.dump_json(os.path.join(attempt_dir, "result.json"), res)
    return res


# ---------------------------------------------------------------- commands

def file_hashes(paths):
    return {os.path.relpath(p, HERE): bl.sha256_file(p) for p in sorted(paths) if os.path.isfile(p)}


def write_manifest(cfg, config_path, tasks, order, extra=None):
    own = [os.path.join(HERE, n) for n in ("harness.py", "benchlib.py", "grade.py")]
    own += [os.path.join(HERE, "arms", n) for n in os.listdir(os.path.join(HERE, "arms"))]
    if cfg["dry_run"]:
        own += [os.path.join(HERE, "dryrun", n) for n in os.listdir(os.path.join(HERE, "dryrun"))]
    drift_bin = cfg["drift"].get("binary")
    manifest = {
        "schema": "drift-benchmark-manifest/1",
        "harness_version": HARNESS_VERSION,
        "dry_run": cfg["dry_run"],
        "seed": cfg["seed"],
        "config_sha256": bl.sha256_file(config_path),
        "config": {k: v for k, v in cfg.items() if k not in ("mirrors",)},
        "model": cfg["model"],
        "agent_version": version_of(cfg["agent"]["version_command"]) if cfg["agent"].get("version_command") else "not given",
        "drift_version": version_of([drift_bin, "--version"]) if drift_bin else "no drift arm",
        "drift_binary_sha256": bl.sha256_file(drift_bin) if drift_bin and os.path.isfile(drift_bin) else None,
        "git_version": version_of(["git", "--version"]),
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "harness_files": file_hashes(own),
        "tasks": {t["id"]: bl.sha256_file(t["_path"]) for t in tasks},
        "arms": cfg["arms"],
        "runs_per_arm": cfg["runs_per_arm"],
        "order": [{"task": t, "arm": a, "run": r, "run_id": run_id(cfg, t, a, r)} for t, a, r in order],
    }
    if extra:
        manifest.update(extra)
    os.makedirs(cfg["runs_root"], exist_ok=True)
    bl.dump_json(os.path.join(cfg["runs_root"], "manifest.json"), manifest)
    return manifest


def cmd_plan(cfg, tasks):
    order = run_order(cfg, tasks)
    print("%d tasks x %d arms x %d runs = %d runs" % (len(tasks), len(cfg["arms"]), cfg["runs_per_arm"], len(order)))
    for t, a, r in order:
        print("%s  %-24s %-9s run %d" % (run_id(cfg, t, a, r), t, a, r))
    return 0


def cmd_run(cfg, config_path, tasks, limit, keep):
    by_id = {t["id"]: t for t in tasks}
    order = run_order(cfg, tasks)
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    manifest = write_manifest(cfg, config_path, tasks, order, {"started_at": started})
    if cfg["dry_run"] is False and manifest["agent_version"].startswith("unavailable"):
        raise SystemExit("the agent's version command failed: %s" % manifest["agent_version"])
    root = cfg["runs_root"]
    spent = 0.0
    done = 0
    counts = {}
    for t, a, r in order:
        if limit is not None and done >= limit:
            break
        rid = run_id(cfg, t, a, r)
        rdir = os.path.join(root, "runs", rid)
        final = os.path.join(rdir, "result.json")
        if os.path.exists(final):
            with open(final, encoding="utf-8") as f:
                prev = json.load(f)
            spent += float((prev.get("usage") or {}).get("cost") or 0)
            counts[prev["status"]] = counts.get(prev["status"], 0) + 1
            continue
        limit_cost = cfg.get("total_cost_limit")
        if limit_cost is not None and spent >= float(limit_cost):
            print("stopped: total_cost_limit %s reached (spent %.2f)" % (limit_cost, spent))
            break
        attempts = []
        for attempt in range(1, 2 + int(cfg["retry_harness_errors"])):
            res = one_run(cfg, by_id[t], a, r, os.path.join(rdir, "a%d" % attempt), keep)
            attempts.append("a%d" % attempt)
            if res["status"] != "harness-error":
                break
        res["attempts"] = attempts
        res["final_attempt"] = attempts[-1]
        bl.dump_json(final, res)
        spent += float((res.get("usage") or {}).get("cost") or 0)
        counts[res["status"]] = counts.get(res["status"], 0) + 1
        done += 1
        print("%s %-24s %-9s run %d: %s (%s s)%s" % (rid, t, a, r, res["status"], res.get("wall_s"),
                                                     " " + res["error"] if res.get("error") else ""))
    write_manifest(cfg, config_path, tasks, order, {
        "started_at": started, "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status_counts": dict(sorted(counts.items())), "cost_reported": spent,
        "policy_consistency": policy_consistency(cfg, tasks)})
    return 0


def policy_consistency(cfg, tasks):
    """Drift's setup should give the same policy file on every run of a task:
    lists any (task, arm) whose runs disagree."""
    seen = {}
    for t in tasks:
        for a in cfg["arms"]:
            for r in range(1, cfg["runs_per_arm"] + 1):
                p = os.path.join(cfg["runs_root"], "runs", run_id(cfg, t["id"], a, r), "result.json")
                if os.path.exists(p):
                    with open(p, encoding="utf-8") as f:
                        res = json.load(f)
                    if res.get("policy_sha256"):
                        seen.setdefault((t["id"], a), set()).add(res["policy_sha256"])
    return sorted("%s/%s" % k for k, v in seen.items() if len(v) > 1)


def cmd_status(cfg, tasks):
    order = run_order(cfg, tasks)
    counts = {}
    for t, a, r in order:
        p = os.path.join(cfg["runs_root"], "runs", run_id(cfg, t, a, r), "result.json")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                st = json.load(f)["status"]
        else:
            st = "not-run"
        counts[(a, st)] = counts.get((a, st), 0) + 1
    for (a, st), n in sorted(counts.items()):
        print("%-9s %-14s %d" % (a, st, n))
    return 0


def cmd_freeze(cfg, tasks, run_tests):
    """Technical check of each task before any agent run, and the reference
    diff for graders. Writes TASKS_DIR/reference/<id>.diff, sets
    hidden.reference_diff, and TASKS_DIR/freeze-report.json."""
    refdir = os.path.join(cfg["tasks_dir"], "reference")
    os.makedirs(refdir, exist_ok=True)
    report = {}
    scratch = os.path.join(cfg["runs_root"], "freeze")
    for t in tasks:
        rep = {"problems": []}
        mirror = cfg["mirrors"].get(t["repository"])
        try:
            if not mirror:
                raise HarnessError("no mirror")
            for c in (t["base_commit"], t["merge_commit"]):
                git(["cat-file", "-e", c + "^{commit}"], cwd=mirror)
            parent = git(["rev-parse", t["merge_commit"] + "^1"], cwd=mirror).strip()
            if parent != t["base_commit"]:
                rep["problems"].append("base_commit is not the first parent of merge_commit")
            names = sorted(n for n in git(["diff", "--name-only", "--no-renames", t["base_commit"], t["merge_commit"]], cwd=mirror).split("\n") if n)
            if names != sorted(t["hidden"]["changed_files"]):
                rep["problems"].append("changed files differ from the export: %s" % sorted(set(names) ^ set(t["hidden"]["changed_files"])))
            diff = git(["diff", "--no-color", "--no-ext-diff", "--no-renames", t["base_commit"], t["merge_commit"]], cwd=mirror)
            rel = os.path.join("reference", t["id"] + ".diff")
            with open(os.path.join(cfg["tasks_dir"], rel), "w", encoding="utf-8") as f:
                f.write(diff)
            if t["hidden"]["reference_diff"] != rel:
                t["hidden"]["reference_diff"] = rel
                out = {k: v for k, v in t.items() if not k.startswith("_")}
                bl.dump_json(t["_path"], out)
            if run_tests and t.get("test_command"):
                for label, commit in (("base", t["base_commit"]), ("merge", t["merge_commit"])):
                    work = os.path.join(scratch, t["id"] + "-" + label)
                    if os.path.exists(work):
                        shutil.rmtree(work)
                    make_working_copy(cfg, t, work, commit)
                    fenv = plain_env(work + ".home", work + ".home/tmp")
                    if t.get("setup_command"):
                        run_limited(t["setup_command"], work, fenv, cfg["tests"]["timeout_s"], os.devnull, os.devnull, shell=True)
                    code, to, wall = run_limited(t["test_command"], work, fenv, cfg["tests"]["timeout_s"],
                                                 os.path.join(scratch, t["id"] + "-" + label + ".out"),
                                                 os.path.join(scratch, t["id"] + "-" + label + ".err"), shell=True)
                    rep["tests_" + label] = {"exit_code": code, "timed_out": to, "wall_s": wall}
                    shutil.rmtree(work, ignore_errors=True)
                    shutil.rmtree(work + ".home", ignore_errors=True)
                if rep["tests_merge"]["exit_code"] != 0:
                    rep["problems"].append("the test command fails at the merge commit")
        except HarnessError as e:
            rep["problems"].append(str(e))
        report[t["id"]] = rep
        print("%-28s %s" % (t["id"], "OK" if not rep["problems"] else "; ".join(rep["problems"])))
    bl.dump_json(os.path.join(cfg["tasks_dir"], "freeze-report.json"), report)
    return 1 if any(r["problems"] for r in report.values()) else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Agent benchmark harness (agent- and model-agnostic).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("freeze", "plan", "run", "status"):
        s = sub.add_parser(name)
        s.add_argument("--config", required=True)
        s.add_argument("--dry-run", action="store_true")
        if name == "run":
            s.add_argument("--limit", type=int, default=None, help="stop after N new runs (pilots)")
            s.add_argument("--keep-workdirs", action="store_true")
        if name == "freeze":
            s.add_argument("--tests", action="store_true", help="also run each task's test command at base and merge")
    a = ap.parse_args(argv)
    cfg = load_config(a.config, dry_run=a.dry_run)
    tasks = load_tasks(cfg)
    if a.cmd == "plan":
        return cmd_plan(cfg, tasks)
    if a.cmd == "status":
        return cmd_status(cfg, tasks)
    if a.cmd == "freeze":
        return cmd_freeze(cfg, tasks, a.tests)
    return cmd_run(cfg, a.config, tasks, a.limit, a.keep_workdirs)


if __name__ == "__main__":
    sys.exit(main())
