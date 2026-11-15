// Containment for the child `claude -p` sessions.
//
// A child must not inherit the operator's environment (session tokens, messaging sockets,
// user-level skills, plugins and MCP servers, the account email) and must not write outside its
// checkout. Layers:
// - env from an allowlist: PATH, a throwaway per-run HOME and TMPDIR, LANG, and only the
//   credentials claude needs (none here: in this container a bare env authenticates; elsewhere
//   ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / CLAUDE_CODE_OAUTH_TOKEN pass through if set);
// - `--restricted`: confines the file tools to the working directory, and ignores user, project
//   and local settings (so hooks come from `--settings` and the Drift plugin from `--plugin-dir`);
//   `--setting-sources project,local` and `--strict-mcp-config` on top;
// - `--tools` names the only built-in tools available, `--disallowedTools` denies the rest
//   explicitly, and the Bash allowlist is read-only (`drift check`/`drift example` in the drift
//   arm only; the `drift` on PATH is a wrapper that refuses other subcommands and `--root`);
// - the init message's tools, skills, plugins and MCP servers are checked against the expected
//   set (and across arms, apart from the Drift plugin) before the agent's first turn;
// - after the session, files modified outside the checkout are looked for and fail the run.

import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readJson, root } from "./lib.mjs";

export const EXPECTED_TOOLS = ["Bash", "Edit", "Glob", "Grep", "Read", "Skill", "Write"];
export const DISALLOWED = [
  "Task", "Agent", "WebFetch", "WebSearch", "NotebookEdit", "ToolSearch", "Monitor", "TaskStop", "Workflow",
  "SendMessage", "PushNotification", "RemoteTrigger", "ScheduleWakeup", "CronCreate", "CronDelete", "CronList",
  "DesignSync", "EnterWorktree", "ExitWorktree", "ListAgents", "ReportFindings", "Artifact", "ArtifactComments", "ArtifactData",
];
const AUTH_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"];

export const allowedBash = (arm) => [...(arm === "drift" ? ["Bash(drift check:*)", "Bash(drift example:*)"] : []), "Bash(ls:*)", "Bash(git status:*)"];

/** The child's whole environment. `passEnv` adds named variables (e.g. a proxy) when needed. */
export function childEnv({ home, path, passEnv = [] }) {
  const env = { PATH: path ?? process.env.PATH, HOME: home, TMPDIR: join(home, "tmp"), LANG: process.env.LANG || "C.UTF-8" };
  for (const k of [...AUTH_VARS, ...passEnv]) if (process.env[k]) env[k] = process.env[k];
  return env;
}

export function claudeArgs({ prompt, arm, model, maxTurns, settings, pluginDir, resume }) {
  return [
    "-p", prompt,
    "--output-format", "stream-json", "--verbose",
    "--model", model,
    "--max-turns", String(maxTurns),
    "--permission-mode", "acceptEdits",
    "--restricted",
    "--setting-sources", "project,local",
    "--strict-mcp-config",
    "--settings", settings,
    "--tools", EXPECTED_TOOLS.join(","),
    "--allowedTools", allowedBash(arm).join(" "),
    "--disallowedTools", DISALLOWED.join(" "),
    ...(arm === "drift" ? ["--plugin-dir", pluginDir] : []),
    ...(resume ? ["--resume", resume] : []),
  ];
}

/**
 * The Drift plugin as a user installs it: integrations/claude-code (hooks and skill) plus a
 * manifest. Built once per work dir.
 */
export function buildPlugin(work) {
  const dir = join(work, "plugin");
  if (existsSync(join(dir, ".claude-plugin/plugin.json"))) return dir;
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  cpSync(join(root, "integrations/claude-code/hooks"), join(dir, "hooks"), { recursive: true });
  cpSync(join(root, "integrations/claude-code/skills"), join(dir, "skills"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin/plugin.json"), JSON.stringify({ name: "drift", version: "0.0.0", description: "Drift: learned conventions, enforced in-session" }, null, 2));
  return dir;
}

/** `drift` on PATH in the drift arm: logs latency, allows only hook/check/example, never --root. */
export function writeDriftWrapper(work, drift) {
  const p = join(work, "bin", "drift");
  mkdirSync(join(work, "bin"), { recursive: true });
  writeFileSync(
    p,
    `#!/bin/sh
case "$1" in hook|check|example) ;; *) echo "drift: only check and example are available in this session" >&2; exit 2 ;; esac
for a in "$@"; do case "$a" in --root|--root=*) echo "drift: --root is not available in this session" >&2; exit 2 ;; esac; done
tool=
if [ "$1" = hook ]; then
  # The hook event on stdin names the tool: latency is reported per tool.
  in=$(cat)
  tool=$(printf '%s' "$in" | sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\\([A-Za-z0-9_]*\\)".*/\\1/p' | head -n 1)
  s=$(date +%s%N)
  out=$(printf '%s' "$in" | "${drift}" "$@"); code=$?
else
  s=$(date +%s%N)
  out=$("${drift}" "$@"); code=$?
fi
e=$(date +%s%N)
[ -n "$out" ] && printf '%s\\n' "$out"
if [ -n "$AB_HOOK_LOG" ]; then
  printf '{"ts":%s,"ms":%s,"code":%s,"bytes":%s,"tool":"%s","args":["%s","%s","%s"]}\\n' "$s" "$(( (e - s) / 1000000 ))" "$code" "\${#out}" "$tool" "$1" "$2" "$3" >> "$AB_HOOK_LOG"
fi
exit $code
`,
  );
  chmodSync(p, 0o755);
  return join(work, "bin");
}

/** What a session's init message says it loaded, reduced to what must match across arms. */
export function initSummary(init) {
  return {
    tools: [...(init.tools ?? [])].sort(),
    mcp_servers: (init.mcp_servers ?? []).map((m) => m.name ?? m),
    skills: [...(init.skills ?? [])].sort(),
    plugins: (init.plugins ?? []).map((p) => (p.path === "builtin" ? p.name : `${p.name} (${p.source ?? p.path})`)).sort(),
    agents: [...(init.agents ?? [])].sort(),
    permissionMode: init.permissionMode,
    apiKeySource: init.apiKeySource,
    model: init.model,
    messaging_socket: init.messaging_socket_path ?? null,
    additional_directories: init.additional_directories ?? [],
  };
}

const isDrift = (s) => /^drift(:|\b)/.test(s);

/**
 * Problems with a session's loaded tool set. `expectedFile` holds the arm-independent part seen
 * first (skills and plugins without Drift's, agents); every later session must match it.
 */
export function checkInit(summary, arm, expectedFile) {
  const out = [];
  if (summary.tools.join(",") !== [...EXPECTED_TOOLS].sort().join(",")) out.push(`tools ${summary.tools.join(",")} (expected ${EXPECTED_TOOLS.join(",")})`);
  if (summary.mcp_servers.length) out.push(`MCP servers loaded: ${summary.mcp_servers.join(", ")}`);
  if (summary.messaging_socket) out.push(`messaging socket exposed: ${summary.messaging_socket}`);
  if (summary.additional_directories.length) out.push(`additional directories: ${summary.additional_directories.join(", ")}`);
  const driftSkills = summary.skills.filter(isDrift);
  const driftPlugins = summary.plugins.filter(isDrift);
  if (arm === "drift" && (!driftSkills.length || !driftPlugins.length)) out.push(`drift arm without the Drift plugin/skill (skills: ${driftSkills.join(",") || "none"})`);
  if (arm !== "drift" && (driftSkills.length || driftPlugins.length)) out.push(`control arm has Drift loaded: ${[...driftSkills, ...driftPlugins].join(", ")}`);
  const common = { skills: summary.skills.filter((s) => !isDrift(s)), plugins: summary.plugins.filter((p) => !isDrift(p)), agents: summary.agents };
  let expected = readJson(expectedFile);
  if (!expected) {
    try {
      writeFileSync(expectedFile, JSON.stringify(common, null, 2), { flag: "wx" });
    } catch {}
    expected = readJson(expectedFile) ?? common;
  }
  for (const k of ["skills", "plugins", "agents"]) {
    const extra = common[k].filter((x) => !expected[k].includes(x));
    const missing = expected[k].filter((x) => !common[k].includes(x));
    if (extra.length || missing.length) out.push(`${k} differ from the first session (${expectedFile}): +${extra.join(",")} -${missing.join(",")}`);
  }
  return out;
}

/**
 * path -> "mtime size" for files under `dir`. No symlinks followed; `skipTop` names skipped at the
 * top level; `exclude` absolute paths (and everything under them) skipped at any depth.
 */
export function snapshotTree(dir, { skipTop = [], exclude = [] } = {}) {
  const out = new Map();
  const excluded = (p) => exclude.some((x) => p === x || p.startsWith(x + "/"));
  const walk = (d, depth) => {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      if (depth === 0 && skipTop.includes(e)) continue;
      if (e === ".git" || e === "node_modules" || e === "target") continue;
      const p = join(d, e);
      if (excluded(p)) continue;
      let st;
      try {
        st = lstatSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else out.set(p, `${st.mtimeMs} ${st.size}`);
    }
  };
  if (existsSync(dir) && !excluded(dir)) walk(dir, 0);
  return out;
}

/** The same for a list of paths (files or directories); missing ones are recorded as absent. */
export function snapshotPaths(paths, { exclude = [] } = {}) {
  const out = new Map();
  for (const p of paths) {
    if (exclude.some((x) => p === x || p.startsWith(x + "/"))) continue;
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) for (const [k, v] of snapshotTree(p, { exclude })) out.set(k, v);
    else out.set(p, `${st.mtimeMs} ${st.size}`);
  }
  return out;
}

/** Files created, changed or deleted between two snapshots. */
export function diffSnapshots(before, after, limit = 50) {
  const out = [];
  for (const [p, v] of after) if (before.get(p) !== v && out.length < limit) out.push(p);
  for (const p of before.keys()) if (!after.has(p) && out.length < limit) out.push(`${p} (deleted)`);
  return out;
}

/**
 * Sensitive files in the operator's real HOME. Only these are watched: the rest of HOME is busy
 * with the operator's own tools (and `--work` may live there). Under ~/.claude only the
 * configuration a session could use to change later sessions; ~/.claude/projects, sessions and
 * ~/.claude.json are written by the operator's own Claude Code session all the time.
 */
export const HOME_SENSITIVE = [
  ".claude/settings.json", ".claude/settings.local.json", ".claude/CLAUDE.md", ".claude/agents", ".claude/commands",
  ".claude/skills", ".claude/hooks", ".claude/plugins", ".claude/keybindings.json",
  ".bashrc", ".bash_profile", ".bash_login", ".bash_logout", ".profile", ".zshrc", ".zprofile", ".zshenv",
  ".ssh", ".gitconfig", ".config/git", ".config/gh", ".npmrc",
];

/**
 * What a session could write to but must not: the work dir (minus run dirs and harness files),
 * the dev repo, the harness repo and HOME's sensitive files. `work` and `repos` are excluded from
 * every other root, so a work dir inside HOME or the harness repo is not read as a breach.
 */
export function snapshotOutside({ work, repoDir, repos, home = homedir(), harness = root }) {
  const own = [work, ...(repos ? [repos] : [])];
  return [
    snapshotTree(work, { skipTop: ["runs", "wt", "homes", "ledger.jsonl", "config.json", "init-expected.json", "report.json", "report.md", "verify.json"] }),
    snapshotTree(repoDir, { exclude: [work] }),
    snapshotTree(harness, { exclude: own }),
    snapshotPaths(HOME_SENSITIVE.map((p) => join(home, p)), { exclude: own }),
  ];
}
export const writesOutside = (o, before) => snapshotOutside(o).flatMap((after, i) => diffSnapshots(before[i], after));
