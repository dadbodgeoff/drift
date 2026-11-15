// Build the Studio's committed fixtures by running the real `drift` binary on a
// repository we own: the synthetic "acme" monorepo (scripts/synth-repo.mjs,
// which includes Drift's own parser test fixtures under examples/).
//
//   node scripts/make-fixtures.mjs --drift <drift with census --json> --work <scratch dir> [--drift-before <debug drift>]
//
// `--drift-before`: a debug build of the same Drift, used with DRIFT_TEST_UNSHOWN=1 for step 1 only (init and the
// review decisions). It models a team whose decisions predate the show policy (round 10) and D13-py: what a person
// accepted, blocked or rejected is kept by every later Drift whatever its family, so the policy holds decorator,
// layout, key and import-source conventions the shipped binary would no longer propose. Every fixture file is
// still written by `--drift` (the release binary), after that step. That step's policy and lock are also written
// to scripts/acme-seed/ (the seed).
//
// Without `--drift-before`, step 1 is the seed: scripts/acme-seed/{conventions.yaml,drift.lock}, the policy and lock
// an earlier run's step 1 wrote (#137, a debug build of main 86ee21d), copied into the repository as a team's
// committed policy, and checked against the scenario below. So a release binary alone (the frozen F11 build)
// regenerates every fixture file, with the same decisions. `--no-seed`: `--drift` makes the decisions itself.
//
// Outputs (all committed; all ours, Apache-2.0):
//   fixtures/acme/        slim facts, census, check and security (whole repo, and --diff-base main), practices, map, policy, lock,
//                         session state written by `drift hook claude`,
//                         synthetic transcripts, and the repo's sources
//   fixtures/acme/hook-run/<session>.json
//                         one session played through the real hooks as Claude Code runs them (below): every
//                         hook call's input and the hook's exact output, beside its transcript
//   fixtures/index.json   what the fixture adapter can list
// fixtures/studies/ (research data: labels and census of the 16 study repos) is
// written by scripts/make-study-fixtures.mjs and left alone here.
//
// The scenario: `drift init`; accept the wrapper, guard, layout and layering
// conventions (but the server-action wrapper, a block candidate), block three of them, reject one trivial one,
// leave the rest proposed (one accepted convention is a suggestion, so it advises); commit that as
// branch `main`; then play three agent sessions whose tool calls are applied to the
// repo and whose hook messages are Drift's real output; then one human edit
// that `drift check` reports as new.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { parse } from "yaml";
import { slimFacts } from "../src/shared/contract/slim.ts";
import { makeSnapshot } from "../src/entities/history/snapshot.ts";
import { writeSynthRepo } from "./synth-repo.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const driftRoot = resolve(app, "../..");
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const drift = resolve(arg("--drift"));
const driftBefore = arg("--drift-before") ? resolve(arg("--drift-before")) : null;
const seedDir = join(dirname(fileURLToPath(import.meta.url)), "acme-seed");
// Step 1 from the seed: a release binary cannot turn the show policy off.
const fromSeed = !driftBefore && !process.argv.includes("--no-seed") && existsSync(join(seedDir, "conventions.yaml"));
const work = resolve(arg("--work"));
const ROOT = "/work/acme"; // the path transcripts claim; never a real machine path
const AGENT_MODEL = "agent-model"; // the model transcripts name: a placeholder, never a real model identifier

const out = join(app, "fixtures");
const acmeOut = join(out, "acme");
rmSync(acmeOut, { recursive: true, force: true });
mkdirSync(acmeOut, { recursive: true });
rmSync(work, { recursive: true, force: true });
const repo = join(work, "acme");
mkdirSync(repo, { recursive: true });
writeSynthRepo(repo, driftRoot);

// Sources as first written (the code viewer shows the repo; session edits are diffs).
const env = { ...process.env, DRIFT_CACHE_DIR: join(work, "cache") };
const run = (args, opts = {}) => {
  const r = spawnSync(drift, ["--root", repo, ...args], { env, encoding: "utf8", maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0 && !(opts.allow ?? []).includes(r.status)) throw new Error(`drift ${args.join(" ")} exited ${r.status}: ${r.stderr}`);
  return r.stdout;
};
// Step 1's decisions, made by the debug build with the show policy off when --drift-before is given.
const runBefore = (args, opts = {}) => {
  if (!driftBefore) return run(args, opts);
  const r = spawnSync(driftBefore, ["--root", repo, ...args], { env: { ...env, DRIFT_TEST_UNSHOWN: "1" }, encoding: "utf8", maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0 && !(opts.allow ?? []).includes(r.status)) throw new Error(`drift (before) ${args.join(" ")} exited ${r.status}: ${r.stderr}`);
  return r.stdout;
};

// Background jobs that record an audit entry (all but two): a `calls` rule, which is a suggestion,
// and an `event` key passed to audit(), which its parameter type requires (census `key_type`).
mkdirSync(join(repo, "apps/api/src/jobs"), { recursive: true });
writeFileSync(join(repo, "apps/api/src/jobs/audit.ts"), "export function audit(entry: { event: string; actor?: string }) {\n  return entry.event;\n}\n");
const auditCall = (i) => (i < 47 ? `audit({ event: "job${i}" })` : `audit({ actor: "cron" } as never)`);
for (let i = 10; i < 50; i++)
  writeFileSync(
    join(repo, `apps/api/src/jobs/job${i}.ts`),
    i < 49 ? `import { audit } from "./audit";\n\nexport function runJob${i}() {\n  ${auditCall(i)};\n  return ${i};\n}\n` : `export function runJob${i}() {\n  return ${i};\n}\n`,
  );

// 1. Policy. The server-action wrapper card (default tier) is left proposed: a block candidate (decision D13),
// which the Studio marks and Drift shows to no agent until a person accepts it.
let seeded = null;
if (fromSeed) {
  mkdirSync(join(repo, ".drift"), { recursive: true });
  copyFileSync(join(seedDir, "conventions.yaml"), join(repo, ".drift/conventions.yaml"));
  copyFileSync(join(seedDir, "drift.lock"), join(repo, "drift.lock"));
  seeded = parse(readFileSync(join(seedDir, "conventions.yaml"), "utf8")).conventions;
} else runBefore(["init"]);
const census0 = JSON.parse(runBefore(["census", "--json"]));
// The cards step 1 decides: the seed's conventions (all of them, as that run's init wrote them), or census's proposals.
const pool = seeded ?? census0.proposals;
const pick = (re) => pool.filter((p) => re.test(p.summary)).map((p) => p.id);
const block = [
  ...pick(/app\/api\/workspaces\/\*\* \(route files\) are wrapped in withWorkspace/),
  ...pick(/HTTP handlers in app\/\*\* \(route files\) are wrapped in withAdmin\(\) or withWorkspace/),
  ...pick(/apps\/api: HTTP handlers .* decorated with UseGuards/),
];
const accept = [
  ...pick(/withAdmin\(\)$/),
  ...pick(/render <Footer>/),
  ...pick(/render inside <PageShell>/),
  ...pick(/do not import from apps\/web/),
  ...pick(/extend BaseService/),
  // Suggestions a person accepted before the show policy (round 10) hid their families: a key the callee's type
  // requires (#34) and a Python import source (#35; kept although Python proposals are off, D13-py).
  ...pick(/pass `event` to audit\(\)/),
  ...pick(/take `TypedDict` from typing_extensions/),
  // A suggestion (rule kind `calls`): accepted, it advises.
  ...pick(/jobs\/\*\* .*call audit\(\)|call audit\(\)/),
  // Experimental wiring rules (#38; acme's .drift/config.yaml turns them on): the API's
  // controllers and services are registered in the root module. Suggestions; they advise.
  ...census0.proposals.filter((p) => p.rule.type === "registered_in").map((p) => p.id),
];
const reject = [...pick(/decorated with Injectable/), ...pick(/are named `run\*`/)];
// A suggestion in the block list (under D5, `UseGuards` is a package's decorator) is blocked
// with --force, as a person who chose it before D5 would have it: it keeps blocking.
const OAUTH = { member: "apps/web/app/api/oauth/callback/route.ts#GET", reason: "the OAuth callback runs before any session exists" };
const exempted = pick(/HTTP handlers in app\/\*\* \(route files\) are wrapped in withAdmin\(\) or withWorkspace/);
if (seeded) {
  // The seed holds these decisions already: check it is the scenario's policy, card by card.
  const by = new Map(seeded.map((c) => [c.id, c]));
  const want = (ids, ok, what) => {
    for (const id of ids) if (!ok(by.get(id))) throw new Error(`scripts/acme-seed: ${id} is not ${what}`);
  };
  want(accept, (c) => c?.status === "accepted", "accepted");
  want(block, (c) => c?.status === "accepted" && c.mode === "block", "accepted in block mode");
  want(reject, (c) => c?.status === "rejected", "rejected");
  want(exempted, (c) => (c?.exceptions ?? []).some((e) => e.member === OAUTH.member && e.reason === OAUTH.reason), "marked fine for the OAuth callback");
  if (!block.length || !accept.length) throw new Error("scripts/acme-seed: the scenario's cards are missing");
} else {
  const tierOf = new Map(census0.proposals.map((p) => [p.id, p.tier]));
  const forced = block.filter((id) => tierOf.get(id) === "suggestion");
  runBefore(["review", "--accept", accept.join(","), "--block", block.filter((id) => !forced.includes(id)).join(","), ...(reject.length ? ["--reject", reject.join(",")] : [])]);
  if (forced.length) runBefore(["review", "--block", forced.join(","), "--force"]);
  // A reviewer's "fine because…" (workstream F): the OAuth callback is outside every session by design, so it is
  // marked fine under the blocking route-wrapper convention; drift check lists it as exempt (code `reviewed`).
  for (const id of exempted) runBefore(["review", "--exempt", id, "--member", OAUTH.member, "--reason", OAUTH.reason]);
  if (driftBefore) {
    // Refresh the seed, so a release binary alone can regenerate the fixtures with these decisions.
    mkdirSync(seedDir, { recursive: true });
    copyFileSync(join(repo, ".drift/conventions.yaml"), join(seedDir, "conventions.yaml"));
    copyFileSync(join(repo, "drift.lock"), join(seedDir, "drift.lock"));
  }
}
console.log(`policy${seeded ? " (scripts/acme-seed)" : ""}: ${accept.length} accepted, ${block.length} blocking, ${reject.length} rejected, ${pool.length - accept.length - block.length - reject.length} proposed`);

// A file nested beyond Drift's limit: skipped as too_deep (the scan fails closed on it).
writeFileSync(join(repo, "apps/web/lib/deep-table.ts"), `export const table = ${"[".repeat(1100)}${"]".repeat(1100)};\n`);
// A file whose type arguments through default values make the parser re-read it exponentially
// (crates/drift-cli/tests/parse_budget.rs `defaults.ts`): skipped as too_costly, failing closed.
mkdirSync(join(repo, "apps/web/lib/gen"), { recursive: true });
writeFileSync(join(repo, "apps/web/lib/gen/typed-defaults.ts"), `x=${"a<(y=\n".repeat(25)}b${")>()\n".repeat(25)}`);
// A middleware that records timing only after it hands control on (#60): `recordTiming` is in
// its `after_continuation`, so Drift reads no guard into it.
writeFileSync(
  join(repo, "packages/utils/src/timing.ts"),
  `type Next = () => void;

export function timing(req: { path: string }, res: unknown, next: Next) {
  const started = Date.now();
  next();
  recordTiming(req.path, Date.now() - started);
}

export function recordTiming(route: string, ms: number) {
  return \`\${route} \${ms}ms\`;
}
`,
);

// Branch `main`: the repository with its policy, before the sessions. `check --diff-base main`
// later reports only what the sessions and the human edit introduced.
const git = (...a) => {
  // Fixed dates and identity, so the merge base (and check-diff.json) is the same on every run.
  const when = "2026-11-03T17:40:00Z";
  const r = spawnSync("git", ["-c", "user.name=acme", "-c", "user.email=acme@example.com", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...a], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
writeFileSync(join(repo, ".gitignore"), ".drift/cache/\n.env.local\n");
git("init", "-q");
git("add", "-A");
git("commit", "-qm", "acme with its Drift policy");

// The state "before" (as a previous scan saw it), so Attention can say what changed since.
const before = makeSnapshot({
  at: Date.parse("2026-11-03T17:40:00Z"),
  commit: "9c1e07b",
  files: 0,
  pending: (seeded ? seeded.filter((c) => c.status === "proposed") : census0.proposals).map((p) => p.id).filter((id) => ![...accept, ...block, ...reject].includes(id)),
  check: JSON.parse(run(["check", "--format", "json"], { allow: [1] })),
  security: JSON.parse(run(["security", "--json"])),
});

// 2. Sessions: synthetic transcripts, real hooks.
let clock = Date.parse("2026-11-04T09:12:00Z");
const tick = (s) => new Date((clock += s * 1000)).toISOString();
let uid = 0;
const uuid = () => {
  uid++;
  const h = uid.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${h}`;
};

// The hooks as Claude Code runs them: the plugin's hooks.json (matchers and commands), each command
// through a shell in the project directory, with `drift` on PATH and the event JSON on stdin.
const HOOKS = JSON.parse(readFileSync(join(driftRoot, "integrations/claude-code/hooks/hooks.json"), "utf8")).hooks;
const hookBin = join(work, "bin");
mkdirSync(hookBin, { recursive: true });
symlinkSync(drift, join(hookBin, "drift"));
const CLAUDE_CODE = "2.1.318"; // the Claude Code whose transcript records the real session copies (fixtures' `version`)
/**
 * A hook's `durationMs` as recorded: a fixed stand-in, so the fixtures are byte-identical from run to run (the measured
 * time varies by a few milliseconds and nothing reads it). `--measured-durations` records the real ones.
 */
const HOOK_MS = process.argv.includes("--measured-durations") ? null : 20;
/** Claude Code's record of a hook's command in a transcript (`command`, `hookInfos`): it writes this label, not the command. */
const CC_COMMAND = "command hook";

/**
 * `real`: play the session the way Claude Code 2.1.318 runs hooks and writes its transcript, as read off real
 * transcripts of sessions with Drift's hooks: each event's matching hooks.json commands run through `sh -c`;
 * `hook_success` (stdout, stderr, exit code, duration) only for a hook that printed something, then
 * `hook_additional_context`; Stop's block as a `Stop hook feedback:` meta turn, a `hook_blocking_error` and the
 * `stop_hook_summary`. Every call and its output is kept in `capture` (fixtures/acme/hook-run/<id>.json).
 * Its own clock and uuids, so the other sessions' records do not move.
 */
function session(id, title, real = null) {
  const recs = [];
  let parent = null;
  let rclock = real?.clock ?? 0;
  let rn = 0;
  const now = real ? (s) => new Date((rclock += s * 1000)).toISOString() : tick;
  const nextUuid = real
    ? () => {
        const h = createHash("sha256").update(`${id}:${++rn}`).digest("hex");
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${"89ab"[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
      }
    : uuid;
  const ccFields = real ? { userType: "external", entrypoint: "cli", gitBranch: "main" } : {};
  const push = (r) => {
    const u = nextUuid();
    recs.push({ parentUuid: parent, isSidechain: false, ...r, uuid: u, timestamp: now(r._dt ?? 2), sessionId: id, cwd: ROOT, version: CLAUDE_CODE, ...ccFields, _dt: undefined });
    parent = u;
    return u;
  };
  const capture = [];
  const promptId = () => nextUuid();
  let currentPrompt = null;
  /** The repo's real path never leaves the generator: transcripts and captures say ROOT. */
  const shown = (v) => (typeof v === "string" ? v.split(repo).join(ROOT) : JSON.parse(JSON.stringify(v).split(repo).join(ROOT)));
  /** Every hooks.json command for this event (and tool or source), run as Claude Code runs it. */
  const runHooks = (event, payload, matchOn) => {
    const input = { session_id: id, transcript_path: `/home/agent/.claude/projects/-work-acme/${id}.jsonl`, cwd: repo, permission_mode: "default", hook_event_name: event, ...payload };
    const out = [];
    for (const g of HOOKS[event] ?? []) {
      if (g.matcher && !new RegExp(`^(?:${g.matcher})$`).test(matchOn ?? "")) continue;
      for (const h of g.hooks) {
        const t0 = performance.now();
        const r = spawnSync("sh", ["-c", h.command], {
          cwd: repo,
          env: { ...env, PATH: `${hookBin}:${process.env.PATH}`, CLAUDE_PROJECT_DIR: repo },
          input: JSON.stringify(input),
          encoding: "utf8",
          timeout: (h.timeout ?? 60) * 1000,
        });
        const res = { event, matcher: g.matcher ?? null, command: h.command, input: shown(input), stdout: shown(r.stdout), stderr: shown(r.stderr), exitCode: r.status, durationMs: HOOK_MS ?? Math.round(performance.now() - t0) };
        capture.push(res);
        out.push(res);
      }
    }
    return out;
  };
  const parsed = (res) => {
    const o = res.find((x) => x.stdout.trim());
    return o ? JSON.parse(o.stdout) : null;
  };
  /** `hook_success` for each hook that printed something, then its additional context, as Claude Code records them. */
  const recordHooks = (res, hookName, toolUseID, event, contextHookName = hookName, contextToolUseID = toolUseID) => {
    for (const x of res) {
      if (!x.stdout.trim()) continue;
      push({ type: "attachment", _dt: 0.2, attachment: { type: "hook_success", hookName, toolUseID, hookEvent: event, content: "", stdout: x.stdout, stderr: x.stderr, exitCode: x.exitCode, command: CC_COMMAND, durationMs: x.durationMs } });
      const ctx = JSON.parse(x.stdout)?.hookSpecificOutput?.additionalContext;
      if (ctx)
        push({
          type: "attachment",
          _dt: 0.01,
          attachment: { type: "hook_additional_context", content: [ctx], hookName: contextHookName, toolUseID: contextToolUseID, hookEvent: event },
          rendered: [{ content: `<system-reminder>\n${contextHookName} hook additional context: ${ctx}\n</system-reminder>` }],
          renderedRole: "system",
        });
    }
  };
  const hook = (event, extra) => {
    const r = spawnSync(drift, ["hook", "claude", event], {
      env,
      input: JSON.stringify({ session_id: id, cwd: repo, hook_event_name: event, ...extra }),
      encoding: "utf8",
    });
    const stdout = r.stdout.trim();
    return stdout ? JSON.parse(stdout) : null;
  };
  const abs = (rel) => join(repo, rel);
  const fake = (rel) => `${ROOT}/${rel}`;
  let toolN = 0;
  const S = {
    id,
    title,
    prompt(text) {
      if (real) {
        currentPrompt = promptId();
        const res = runHooks("UserPromptSubmit", { prompt: text });
        push({ type: "user", promptId: currentPrompt, message: { role: "user", content: text }, permissionMode: "default" });
        recordHooks(res, "UserPromptSubmit", "UserPromptSubmit", "UserPromptSubmit");
        return;
      }
      push({ type: "user", message: { role: "user", content: text } });
      // UserPromptSubmit (#38) hands the agent wiring advice queued by the last Stop, once.
      const o = hook("UserPromptSubmit", { prompt: text });
      const ctx = o?.hookSpecificOutput?.additionalContext;
      if (ctx) push({ type: "attachment", _dt: 0.2, attachment: { type: "hook_additional_context", content: [ctx], hookName: "UserPromptSubmit", toolUseID: "UserPromptSubmit", hookEvent: "UserPromptSubmit" } });
    },
    thinking(text, dt = 3) {
      push({ type: "assistant", _dt: dt, message: { role: "assistant", model: AGENT_MODEL, content: [{ type: "thinking", thinking: text }] } });
    },
    say(text, dt = 2) {
      push({ type: "assistant", _dt: dt, message: { role: "assistant", model: AGENT_MODEL, content: [{ type: "text", text }] } });
    },
    sessionStart() {
      if (real) {
        const res = runHooks("SessionStart", { source: "startup" }, "startup");
        recordHooks(res, "SessionStart:startup", nextUuid(), "SessionStart", "SessionStart", "SessionStart");
        return;
      }
      const o = hook("SessionStart", { source: "startup" });
      push({ type: "attachment", _dt: 0.2, attachment: { type: "hook_success", hookName: "SessionStart:startup", toolUseID: "SessionStart", hookEvent: "SessionStart", stdout: o ? JSON.stringify(o) + "\n" : "", exitCode: 0 } });
      const ctx = o?.hookSpecificOutput?.additionalContext;
      if (ctx) push({ type: "attachment", _dt: 0.2, attachment: { type: "hook_additional_context", content: [ctx], hookName: "SessionStart", toolUseID: "SessionStart", hookEvent: "SessionStart" } });
    },
    /** A tool call; for Write/Edit the change is applied to the repo between PreToolUse and PostToolUse. */
    tool(name, input, result, { apply, dt = 2 } = {}) {
      const tid = `toolu_${id.slice(0, 4)}${String(++toolN).padStart(4, "0")}`;
      const realInput = input.file_path ? { ...input, file_path: abs(input.file_path) } : input;
      const shownInput = input.file_path ? { ...input, file_path: fake(input.file_path) } : input;
      const callUuid = push({ type: "assistant", _dt: dt, message: { role: "assistant", model: AGENT_MODEL, content: [{ type: "tool_use", id: tid, name, input: shownInput }] } });
      if (real) {
        recordHooks(runHooks("PreToolUse", { tool_name: name, tool_input: realInput, tool_use_id: tid }, name), `PreToolUse:${name}`, tid, "PreToolUse");
        const tur = apply ? apply() : undefined;
        push({ type: "user", promptId: currentPrompt, message: { role: "user", content: [{ tool_use_id: tid, type: "tool_result", content: result }] }, ...(tur ? { toolUseResult: tur } : {}), sourceToolAssistantUUID: callUuid });
        recordHooks(runHooks("PostToolUse", { tool_name: name, tool_input: realInput, tool_response: tur ? shown(tur) : { content: result }, tool_use_id: tid }, name), `PostToolUse:${name}`, tid, "PostToolUse");
        return;
      }
      let denied = null;
      if (["Write", "Edit", "Bash"].includes(name)) {
        const pre = hook("PreToolUse", { tool_name: name, tool_input: realInput });
        if (pre) {
          push({ type: "attachment", _dt: 0.2, attachment: { type: "hook_success", hookName: `PreToolUse:${name}`, toolUseID: tid, hookEvent: "PreToolUse", stdout: JSON.stringify(pre) + "\n", exitCode: 0 } });
          const h = pre.hookSpecificOutput ?? {};
          if (h.permissionDecision === "deny") denied = h.permissionDecisionReason;
          else if (h.additionalContext && name !== "Bash")
            push({ type: "attachment", _dt: 0.2, attachment: { type: "hook_additional_context", content: [h.additionalContext], hookName: `PreToolUse:${name}`, toolUseID: tid, hookEvent: "PreToolUse" } });
        }
      }
      if (denied) {
        push({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: tid, is_error: true, content: `Hook PreToolUse:${name} denied this tool call: ${denied}` }] } });
        return;
      }
      let tur;
      if (apply) tur = apply();
      push({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: tid, content: result }] }, ...(tur ? { toolUseResult: tur } : {}) });
      if (["Write", "Edit"].includes(name)) {
        const post = hook("PostToolUse", { tool_name: name, tool_input: realInput });
        const ctx = post?.hookSpecificOutput?.additionalContext;
        push({ type: "attachment", _dt: 0.2, attachment: { type: "hook_success", hookName: `PostToolUse:${name}`, toolUseID: tid, hookEvent: "PostToolUse", stdout: post ? JSON.stringify(post) + "\n" : "", exitCode: 0 } });
        if (ctx) push({ type: "attachment", _dt: 0.2, attachment: { type: "hook_additional_context", content: [ctx], hookName: `PostToolUse:${name}`, toolUseID: tid, hookEvent: "PostToolUse" } });
      }
    },
    write(rel, content, dt) {
      const existed = existsSync(abs(rel));
      const said = existed ? `The file ${fake(rel)} has been updated.` : `File created successfully at: ${fake(rel)}`;
      this.tool("Write", { file_path: rel, content }, real ? `${said}${existed ? "" : " (file state is current in your context — no need to Read it back)"}` : said, {
        dt,
        apply: () => {
          mkdirSync(dirname(abs(rel)), { recursive: true });
          writeFileSync(abs(rel), content);
          return { type: existed ? "update" : "create", filePath: fake(rel), content, structuredPatch: [] };
        },
      });
    },
    edit(rel, old_string, new_string, dt) {
      this.tool("Edit", { file_path: rel, old_string, new_string, replace_all: false }, real ? `The file ${fake(rel)} has been updated successfully.` : `The file ${fake(rel)} has been updated.`, {
        dt,
        apply: () => {
          const before = readFileSync(abs(rel), "utf8");
          if (!before.includes(old_string)) throw new Error(`${id}: edit of ${rel} does not apply`);
          const after = before.replace(old_string, new_string);
          writeFileSync(abs(rel), after);
          const tur = { filePath: fake(rel), oldString: old_string, newString: new_string, structuredPatch: patch(before, after) };
          return real ? { ...tur, originalFile: before, userModified: false, replaceAll: false } : tur;
        },
      });
    },
    /** A Read (no hook matches it), with Claude Code's numbered lines. */
    read(rel, dt) {
      const text = readFileSync(abs(rel), "utf8");
      const lines = text.replace(/\n$/, "").split("\n");
      const numbered = lines.map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join("\n");
      this.tool("Read", { file_path: rel }, numbered, { dt, apply: real ? () => ({ type: "text", file: { filePath: fake(rel), content: text, numLines: lines.length, startLine: 1, totalLines: lines.length } }) : undefined });
    },
    stop() {
      if (real) {
        const stopId = nextUuid();
        const res = runHooks("Stop", { stop_hook_active: false });
        const o = parsed(res);
        const summary = { type: "system", _dt: 0.01, subtype: "stop_hook_summary", hookCount: res.length, hookInfos: res.map((x) => ({ command: CC_COMMAND, durationMs: x.durationMs })), hookErrors: [], hookAdditionalContext: [], preventedContinuation: false, stopReason: "", hasOutput: false, level: "suggestion", toolUseID: stopId };
        if (o?.decision === "block") {
          push({ type: "user", _dt: 0.3, promptId: currentPrompt, message: { role: "user", content: `Stop hook feedback:\n${o.reason}` }, isMeta: true });
          push({ type: "attachment", _dt: 0, attachment: { type: "hook_blocking_error", hookName: "Stop", toolUseID: stopId, hookEvent: "Stop", blockingError: { blockingError: o.reason, command: CC_COMMAND } }, rendered: [{ content: `<system-reminder>\nStop hook blocking error from command: "${CC_COMMAND}": ${o.reason}\n</system-reminder>` }], renderedRole: "system" });
          push({ ...summary, hookInfos: res.map(() => ({ command: CC_COMMAND })), hookErrors: [o.reason], hasOutput: true });
          return true;
        }
        // A Stop that printed something without blocking (a systemMessage for the person) is not in any real
        // transcript we have read; the scenario below never meets one, and says so if it does.
        if (o) throw new Error(`${id}: Stop printed output without blocking; the real-shape record for it is unknown: ${JSON.stringify(o)}`);
        push({ ...summary, _dt: 0.3 });
        return false;
      }
      const stopId = `stop-${id.slice(0, 4)}-${uid}`;
      const o = hook("Stop", { stop_hook_active: false });
      if (o?.decision === "block") {
        push({ type: "attachment", _dt: 0.2, attachment: { type: "hook_blocking_error", hookName: "Stop", toolUseID: stopId, hookEvent: "Stop", blockingError: { blockingError: o.reason, command: "drift hook claude Stop" } } });
        push({ type: "system", _dt: 0.1, subtype: "stop_hook_summary", hookCount: 1, hookErrors: [o.reason], preventedContinuation: false, toolUseID: stopId });
        return true;
      }
      if (o?.systemMessage)
        push({ type: "attachment", _dt: 0.2, attachment: { type: "hook_success", hookName: "Stop", toolUseID: stopId, hookEvent: "Stop", stdout: JSON.stringify(o) + "\n", exitCode: 0 } });
      push({ type: "system", _dt: 0.1, subtype: "stop_hook_summary", hookCount: 1, hookErrors: [], preventedContinuation: false, toolUseID: stopId });
      return false;
    },
    records: () => recs,
    capture: () => capture,
    real: !!real,
  };
  return S;
}

/** A single-hunk structured patch between two texts (enough for fixtures). */
function patch(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length - 1;
  let eb = b.length - 1;
  while (ea >= s && eb >= s && a[ea] === b[eb]) {
    ea--;
    eb--;
  }
  const ctx = 3;
  const from = Math.max(0, s - ctx);
  const lines = [
    ...a.slice(from, s).map((l) => " " + l),
    ...a.slice(s, ea + 1).map((l) => "-" + l),
    ...b.slice(s, eb + 1).map((l) => "+" + l),
    ...a.slice(ea + 1, Math.min(a.length, ea + 1 + ctx)).map((l) => " " + l),
  ];
  return [{ oldStart: from + 1, oldLines: lines.filter((l) => !l.startsWith("+")).length, newStart: from + 1, newLines: lines.filter((l) => !l.startsWith("-")).length, lines }];
}

const ROUTE_UNGUARDED = (what) => `import { db } from "@acme/db";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const workspaceId = new URL(req.url).pathname.split("/")[3];
  const ${what} = await db.link.count({ where: { workspaceId, archived: false } });
  return NextResponse.json({ ${what} });
}
`;
const ROUTE_GUARDED = (what) => `import { db } from "@acme/db";
import { NextResponse } from "next/server";
import { withWorkspace } from "@/lib/auth";

export const GET = withWorkspace(async (req, { workspaceId }) => {
  const ${what} = await db.link.count({ where: { workspaceId, archived: false } });
  return NextResponse.json({ ${what} });
});
`;

const sessions = [];

// R (first, on the repository as committed on main): the real hooks, as Claude Code runs them, on an edit
// that breaks a blocking convention. PostToolUse advises (the violation is marked as one that blocks),
// Stop blocks the end of the turn, the agent restores the wrapper, and the next Stop lets the turn end.
// The agent's turns are scripted; every hook record is what the hooks printed. It ends with the route
// as it was plus the change asked for (same lines, so the other sessions meet the same facts).
{
  const rel = "apps/web/app/api/workspaces/[id]/links/route.ts";
  const guarded = (q) => `export const GET = withWorkspace(async (req, { workspaceId }) => {\n  const rows = await db.link.findMany(${q});\n  return NextResponse.json(rows);\n});`;
  const where = "{ where: { workspaceId, archived: false } }";
  const sorted = '{ where: { workspaceId, archived: false }, orderBy: { createdAt: "desc" } }';
  const plain = `export async function GET(req: Request) {\n  const workspaceId = new URL(req.url).pathname.split("/")[3];\n  const rows = await db.link.findMany(${sorted});\n  return NextResponse.json(rows);\n}`;
  const s = session("7a3c9e15-4b2d-4f6a-8c1e-0d9b2f4a6e83", "Sort links newest first (real hooks, one block)", { clock: Date.parse("2026-11-04T08:40:00Z") });
  s.sessionStart();
  s.prompt("Make GET /api/workspaces/[id]/links return the links newest first.");
  s.thinking("Let me read the links route first.", 3);
  s.read(rel, 2);
  s.thinking("The handler only needs an orderBy. The workspace id is in the URL, so I'll write GET as a plain handler that reads it from there.", 4);
  s.edit(rel, guarded(where), plain, 6);
  s.say("GET /api/workspaces/[id]/links now returns links newest first (`orderBy: { createdAt: \"desc\" }`).");
  if (!s.stop()) throw new Error("the real-hooks session: Stop did not block the unwrapped route");
  s.thinking("Drift blocked the end of the turn: workspace route handlers are wrapped in withWorkspace(), and my plain GET reads the workspace id from the URL without checking the caller belongs to it. I'll restore the wrapper and keep the ordering.", 3);
  s.edit(rel, plain, guarded(sorted), 5);
  s.say("Restored `withWorkspace()` around GET, so it checks the caller's workspace again; the links are still sorted newest first.");
  if (s.stop()) throw new Error("the real-hooks session: Stop blocked after the fix");
  sessions.push(s);
}

// D (oldest): secrets in the first prompt and in a written file, for redaction.
// AKIAIOSFODNN7EXAMPLE and its secret are AWS's documented example credentials.
{
  const prompt = "Set up the export bucket. The access key is AKIAIOSFODNN7EXAMPLE; put the credentials in apps/web/.env.local.";
  const s = session("1e7d0b9a-5c2f-4e8d-b6a1-3f9c8e2d4a10", prompt);
  s.sessionStart();
  s.prompt(prompt);
  s.write(
    "apps/web/.env.local",
    "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nAWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\nEXPORT_BUCKET=acme-exports\nSIGNING_KEY_PEM=\n-----BEGIN PRIVATE KEY-----\nEXAMPLEONLYnotarealkeyEXAMPLEONLYnotarealkey\nEXAMPLEONLYsecondlineEXAMPLEONLY\n-----END PRIVATE KEY-----\n",
    6,
  );
  s.say("Wrote the credentials to apps/web/.env.local, which is git-ignored.");
  s.stop();
  sessions.push(s);
}

// A: Drift advises on an unguarded route; the agent fixes it.
{
  const s = session("5f0c2a7e-1b3d-4c8a-9e21-7a6b4c3d2e10", "Add a link-count endpoint");
  s.sessionStart();
  s.prompt("Add an endpoint GET /api/workspaces/[id]/link-count that returns { count } for the workspace's non-archived links.");
  s.thinking("I need to find where workspace API routes live and copy their structure. Let me list app/api/workspaces first, then read one route.");
  s.tool("Bash", { command: "ls apps/web/app/api/workspaces/[id] && cat apps/web/.env.example", description: "List workspace routes and the env example" },
    "alerts\naudit\nbilling\nbranding\nbudgets\nchannels\n…\n---\nDATABASE_URL=postgres://localhost:5432/acme\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nGITHUB_TOKEN=ghp_EXAMPLEexampleEXAMPLEexample0123456789\n");
  s.tool("Read", { file_path: "apps/web/app/api/workspaces/[id]/links/route.ts" }, "     1\timport { db } from \"@acme/db\";\n     2\timport { NextResponse } from \"next/server\";\n     3\timport { withWorkspace } from \"@/lib/auth\";\n…");
  s.thinking("The prisma client is exported from @acme/db. A count is a one-liner; I'll write the route as a plain GET handler.", 4);
  s.write("apps/web/app/api/workspaces/[id]/link-count/route.ts", ROUTE_UNGUARDED("count"), 9);
  s.thinking("Drift reports that HTTP handlers under app/api/workspaces are wrapped in withWorkspace(), 68 of 70. My handler reads the workspace id from the URL without any auth check, so anyone could count another workspace's links. I'll wrap it the same way links/route.ts does.", 5);
  s.edit("apps/web/app/api/workspaces/[id]/link-count/route.ts", ROUTE_UNGUARDED("count"), ROUTE_GUARDED("count"), 6);
  s.say("Added `GET /api/workspaces/[id]/link-count`. It is wrapped in `withWorkspace()` like the other workspace routes, so it is authenticated and scoped to the caller's workspace.");
  s.stop();
  sessions.push(s);
}

// B: the agent tries to edit Drift's policy (denied), ends the turn with a blocking violation, then fixes it.
{
  const s = session("8d41e6b2-77c0-4f2e-a5d3-1c9e0b6a4f27", "Export all links (blocked once)");
  s.sessionStart();
  s.prompt("Quick fix: add GET /api/workspaces/[id]/export-all that returns every link as CSV. Just make it work.");
  s.write("apps/web/app/api/workspaces/[id]/export-all/route.ts", ROUTE_UNGUARDED("rows"), 7);
  s.thinking("Drift flags the missing withWorkspace wrapper. The user said just make it work; maybe the rule is too strict for an export. I could relax it in the conventions file.", 4);
  s.tool("Edit", { file_path: ".drift/conventions.yaml", old_string: "mode: block", new_string: "mode: advise", replace_all: false }, "", {});
  s.thinking("The edit was denied. A shell command would change the file directly.", 2);
  s.tool("Bash", { command: "sed -i 's/mode: block/mode: advise/' .drift/conventions.yaml", description: "Relax the convention in the policy file" }, "", {});
  s.say("The export endpoint is in place.");
  const blocked = s.stop();
  if (blocked) {
    s.thinking("Drift blocked the end of the turn: the export route is a new violation of a blocking convention, and I may not change the policy file. Wrapping the handler is the right fix anyway.", 3);
    s.edit("apps/web/app/api/workspaces/[id]/export-all/route.ts", ROUTE_UNGUARDED("rows"), ROUTE_GUARDED("rows"), 5);
    s.say("Wrapped the export route in `withWorkspace()`; it now requires a member of the workspace.");
    s.stop();
  }
  sessions.push(s);
}

// C: an intentional exception, suppressed with a reason.
{
  const s = session("c3a9f1d4-2e6b-4a70-8b15-f0e2d7c6b5a3", "Public uptime probe (suppressed)");
  s.sessionStart();
  s.prompt("Add GET /api/workspaces/[id]/ping for the load balancer health check. It must not require auth.");
  const body = `import { NextResponse } from "next/server";

// drift-ignore D-ed1ec0: load balancer health probe, intentionally public
export async function GET() {
  return NextResponse.json({ ok: true });
}
`;
  const rel = "apps/web/app/api/workspaces/[id]/ping/route.ts";
  const first = `// drift-ignore ${block[0]}: load balancer health probe, intentionally public`;
  s.write(rel, body.replace(/\/\/ drift-ignore .*\n/, first + "\n"), 8);
  s.say("Added an unauthenticated ping route and recorded why with a `drift-ignore` comment, so reviewers see the exception.");
  if (s.stop()) {
    s.thinking(`Drift blocked the turn: a second convention (${block[1]}, every HTTP handler under app/ is wrapped in withAdmin() or withWorkspace()) also covers this route. The exception is the same, so I'll record it for that convention too.`, 3);
    s.edit(rel, first, `${first}\n// drift-ignore ${block[1]}: load balancer health probe, intentionally public`, 4);
    s.say("Both conventions that cover API routes now carry the documented exception.");
    s.stop();
  }
  sessions.push(s);
}

// E: the agent adds an API resource but does not register its service (wiring, #38). Stop
// advises the person; the next prompt hands the advice to the agent, which registers it.
{
  const s = session("e5b2c8d1-7a4f-4c3e-9d6b-2a1f0e9c8b7d", "Refunds API (registered after wiring advice)");
  s.sessionStart();
  s.prompt("Add a refunds resource to the API: a controller with GET /refunds/:id and a service.");
  const svc = `import { Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";

@Injectable()
export class RefundsService extends BaseService {
  async get(id: string) {
    this.log("get " + id);
    return this.db.link.findFirst({ where: { id } });
  }
}
`;
  const ctl = `import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { RefundsService } from "./refunds.service";

@Controller("refunds")
@UseGuards(AuthGuard)
export class RefundsController {
  constructor(private readonly service: RefundsService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }
}
`;
  s.write("apps/api/src/refunds/refunds.service.ts", svc, 6);
  s.write("apps/api/src/refunds/refunds.controller.ts", ctl, 5);
  s.say("Added `RefundsController` and `RefundsService` under `apps/api/src/refunds/`.");
  s.stop();
  s.prompt("Thanks. Does it need anything else?");
  s.thinking("Drift says the new classes are not wired: every controller and service is listed in the root module, and these are not.", 3);
  s.edit("apps/api/src/app.module.ts", "import { UsersController }", 'import { RefundsController } from "./refunds/refunds.controller";\nimport { RefundsService } from "./refunds/refunds.service";\nimport { UsersController }', 3);
  s.edit("apps/api/src/app.module.ts", "  controllers: [\n", "  controllers: [\n    RefundsController,\n", 2);
  s.edit("apps/api/src/app.module.ts", "  providers: [\n", "  providers: [\n    RefundsService,\n", 2);
  s.say("Registered both in `AppModule` (controllers and providers), like their siblings.");
  s.stop();
  sessions.push(s);
}

// 3. A human edit after the sessions: new and blocking.
mkdirSync(join(repo, "apps/web/app/api/workspaces/[id]/archive-all"), { recursive: true });
writeFileSync(join(repo, "apps/web/app/api/workspaces/[id]/archive-all/route.ts"), ROUTE_UNGUARDED("archived"));
// And a service nobody registered: drift check reports where it goes (`wire`, #38).
mkdirSync(join(repo, "apps/api/src/payouts"), { recursive: true });
writeFileSync(
  join(repo, "apps/api/src/payouts/payouts.service.ts"),
  `import { Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";

@Injectable()
export class PayoutsService extends BaseService {
  async list() {
    return this.db.link.findMany();
  }
}
`,
);

// 4. Outputs.
const factsPath = join(work, "facts.json");
run(["scan", "--out", factsPath]);
const facts = slimFacts(JSON.parse(readFileSync(factsPath, "utf8")));
writeFileSync(join(acmeOut, "facts.json.gz"), gzipSync(JSON.stringify(facts), { level: 9, mtime: 0 }));
const census = JSON.parse(run(["census", "--json"]));
census.root = ROOT;
// The build that wrote the fixture (a local tag such as `DRIFT_BUILD_COMMIT`) is not part of it.
census.commit = null;
const json = (name, v) => writeFileSync(join(acmeOut, name), JSON.stringify(v, null, 1) + "\n");
json("census.json", census);
json("check.json", JSON.parse(run(["check", "--format", "json"], { allow: [1] })));
const diff = JSON.parse(run(["check", "--format", "json", "--diff-base", "main"], { allow: [1] }));
// The merge base is a commit of this generated repository; keep it, it is ours.
json("check-diff.json", diff);
json("security.json", JSON.parse(run(["security", "--json"])));
// What the change since `main` introduces, as a pull request sees it (exit 0: facts for review, never a failure).
json("security-diff.json", JSON.parse(run(["security", "--json", "--diff-base", "main"])));
// Each block candidate's one question, as `drift review --json` asks it (the fixture API serves this file).
json("review-questions.json", JSON.parse(run(["review", "--json"])));
// The practice map (round 13; read-only) and the structural map's package dependencies (production and test apart).
const practices = JSON.parse(run(["practices", "--json"]));
practices.commit = null;
json("practices.json", practices);
json("map.json", JSON.parse(run(["map", "--json"])));
json("version.json", { version: run(["--version"]).trim() });
json("history.json", { snapshots: [{ ...before, files: facts.files.length }], audit: [] });
copyFileSync(join(repo, ".drift/conventions.yaml"), join(acmeOut, "conventions.yaml"));
copyFileSync(join(repo, "drift.lock"), join(acmeOut, "drift.lock"));
mkdirSync(join(acmeOut, "sessions"), { recursive: true });
mkdirSync(join(acmeOut, "transcripts"), { recursive: true });
const index = [];
for (const s of sessions) {
  const text = s.records().map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(join(acmeOut, "transcripts", `${s.id}.jsonl`), text);
  const state = join(repo, ".drift/cache/sessions", `${s.id}.json`);
  const hasState = existsSync(state);
  if (hasState) copyFileSync(state, join(acmeOut, "sessions", `${s.id}.json`));
  const times = s.records().map((r) => Date.parse(r.timestamp));
  index.push({ id: s.id, project: ROOT, title: s.title, bytes: text.length, modified: Math.max(...times), hasState, ...(s.real ? { realHooks: true } : {}) });
  if (s.real) {
    mkdirSync(join(acmeOut, "hook-run"), { recursive: true });
    json(`hook-run/${s.id}.json`, {
      "//": "Every hook call of this session, as Claude Code made it (integrations/claude-code/hooks/hooks.json, sh -c, event JSON on stdin) and what the hook printed, byte for byte (the repository's path written as /work/acme). Written by scripts/make-fixtures.mjs.",
      session: s.id,
      drift: run(["--version"]).trim(),
      claudeCode: CLAUDE_CODE,
      hooks: "integrations/claude-code/hooks/hooks.json",
      calls: s.capture(),
    });
  }
}
// Sources: the whole synthetic repo as it is now (ours), minus Drift's own files.
cpSync(repo, join(acmeOut, "sources"), { recursive: true, filter: (p) => !p.includes(`${repo}/.drift`) && !p.includes(`${repo}/.git`) && !p.endsWith("drift.lock") && !p.endsWith(".env.local") });

const prev = existsSync(join(out, "index.json")) ? JSON.parse(readFileSync(join(out, "index.json"), "utf8")) : {};
const studiesDir = join(out, "studies");
const studies = existsSync(studiesDir)
  ? {
      census: readdirSync(studiesDir).filter((f) => f.startsWith("census-")).map((f) => f.slice(7, -5)).sort(),
      ab: readdirSync(studiesDir).filter((f) => f.startsWith("results-")).map((f) => f.slice(8, -5)).sort(),
      runs: prev.studies?.runs ?? [],
      // Written by make-study-fixtures.mjs (a run's views with a repo left out); kept as they are.
      ...(prev.studies?.variants ? { variants: prev.studies.variants } : {}),
    }
  : (prev.studies ?? { census: [], ab: [] });
// The other committed repositories (scripts/make-round11-fixtures.mjs) keep their entries, after acme.
const others = (prev.repos ?? []).filter((r) => r.id !== "acme");
writeFileSync(join(out, "index.json"), JSON.stringify({ repos: [{ id: "acme", path: ROOT, name: "acme", practices: true, map: true }, ...others], sessions: index, studies }, null, 1) + "\n");
console.log(`fixtures written to ${out}: ${facts.files.length} files, ${census.proposals.length} proposals, ${sessions.length} sessions`);
