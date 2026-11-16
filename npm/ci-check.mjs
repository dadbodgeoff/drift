// Cheap CI guard for the release path, without building Drift:
//
//   node npm/ci-check.mjs <dir with node_modules/yaml>
//
// 1. Parses action.yml, the workflows and .pre-commit-hooks.yaml, and checks the
//    shape GitHub and pre-commit need (an unquoted `: ` once made action.yml
//    unloadable).
// 2. release.yml cannot publish from a rehearsal: the manual run defaults to
//    dry_run, every job that publishes (GitHub Release, attestation, npm publish)
//    runs only when the verify job says `publish`, only those jobs ask for write
//    permissions, no job reads a secret, and artifact names cannot collide across a
//    matrix. The verify step itself is run for a rehearsal, a refused manual real
//    run, a matching tag, a mismatched tag and a branch push.
// 3. Versions agree (npm/set-version.mjs --check), the plugin hooks run `drift`,
//    and every file names the same repository.
// 4. Runs release.yml's own steps on stub binaries that lost their executable bit,
//    as artifacts do between jobs: the binary version check, "Archive and checksum"
//    (the archived binary must be executable), "Build and pack the npm packages"
//    (exactly the expected files, no install scripts), and the install-test job's
//    step (installs the tarballs offline and runs the launcher, whose stub binary
//    reports a version and echoes other arguments).
// 5. Runs the npm job's Publish step on those tarballs with a stub `npm` (publishes
//    nothing): order, dist-tag, and a re-run skipping versions the registry has.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const yamlDir = process.argv[2];
if (!yamlDir) {
  console.error("usage: node npm/ci-check.mjs <dir with node_modules/yaml>");
  process.exit(2);
}
const YAML = createRequire(join(yamlDir, "noop.js"))("yaml");
const failures = [];
const fail = (msg) => failures.push(msg);

function parse(rel) {
  const doc = YAML.parseDocument(readFileSync(join(repo, rel), "utf8"), { prettyErrors: true });
  for (const e of doc.errors) fail(`${rel}: ${e.message}`);
  return doc.errors.length ? null : doc.toJS();
}

// 1. YAML and shape.
const action = parse("action.yml");
if (action) {
  for (const k of ["name", "description", "runs"]) if (!action[k]) fail(`action.yml: missing ${k}`);
  if (action.runs?.using !== "composite") fail("action.yml: runs.using is not composite");
  for (const [i, s] of (action.runs?.steps ?? []).entries()) {
    if (!s.uses && !s.run) fail(`action.yml: step ${i} has neither uses nor run`);
    if (s.run && !s.shell) fail(`action.yml: step ${i} (${s.name ?? "run"}) needs shell (composite actions)`);
  }
  for (const [k, v] of Object.entries(action.inputs ?? {})) {
    if (typeof v?.description !== "string") fail(`action.yml: input ${k} has no description`);
  }
}
const workflows = {};
for (const f of readdirSync(join(repo, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f))) {
  const rel = `.github/workflows/${f}`;
  const wf = parse(rel);
  if (!wf) continue;
  workflows[f] = wf;
  if (!wf.on) fail(`${rel}: no triggers`);
  for (const [id, job] of Object.entries(wf.jobs ?? {})) {
    if (!job["runs-on"] && !job.uses) fail(`${rel}: job ${id} has no runs-on`);
    for (const n of [job.needs ?? []].flat()) if (!wf.jobs[n]) fail(`${rel}: job ${id} needs unknown job ${n}`);
  }
}
const hooks = parse(".pre-commit-hooks.yaml");
if (hooks) {
  for (const h of hooks) {
    for (const k of ["id", "name", "entry", "language"]) if (!h[k]) fail(`.pre-commit-hooks.yaml: ${h.id ?? "?"} missing ${k}`);
  }
}

const config = JSON.parse(readFileSync(join(repo, "npm/config.json"), "utf8"));
const release = workflows["release.yml"];
const jobs = release?.jobs ?? {};
const step = (job, name) => {
  const s = jobs[job]?.steps?.find((s) => s.name === name || s.name?.startsWith(name));
  if (!s) fail(`release.yml: no step '${name}' in the ${job} job`);
  return s;
};

// 2. A rehearsal cannot publish.
const PUBLISH_GATE = "needs.verify.outputs.publish == 'true'";
if (release) {
  if (!release.on?.push?.tags?.length) fail("release.yml: not triggered by a pushed tag");
  const dry = release.on?.workflow_dispatch?.inputs?.dry_run;
  if (dry?.type !== "boolean" || dry?.default !== true) fail("release.yml: workflow_dispatch needs a boolean dry_run input that defaults to true");
  if (/\bsecrets\./.test(JSON.stringify(release))) fail("release.yml: reads a secret (trusted publishing and github.token need none)");
  const artifactNames = new Map();
  for (const [id, job] of Object.entries(jobs)) {
    const steps = job.steps ?? [];
    // A command at the start of a line, so a message that names one does not count.
    const publishes = steps.some(
      (s) => /attest/.test(s.uses ?? "") || /^\s*(npm publish|gh release (create|upload|edit)|git (tag|push))\b/m.test(s.run ?? ""),
    );
    const writes = Object.entries(job.permissions ?? {}).filter(([, v]) => v === "write").map(([k]) => k);
    if (publishes) {
      if (!String(job.if ?? "").includes(PUBLISH_GATE)) fail(`release.yml: job ${id} publishes but does not run only if ${PUBLISH_GATE}`);
      if (![job.needs ?? []].flat().includes("verify")) fail(`release.yml: job ${id} publishes but does not need verify`);
    } else if (writes.length) {
      fail(`release.yml: job ${id} publishes nothing but asks for write permission (${writes.join(", ")})`);
    }
    for (const s of steps.filter((s) => /actions\/upload-artifact/.test(s.uses ?? ""))) {
      const name = s.with?.name;
      if (!name) fail(`release.yml: job ${id} uploads an artifact with no name`);
      else if (job.strategy?.matrix && !name.includes("${{ matrix.")) fail(`release.yml: job ${id} is a matrix and its artifact ${name} has the same name in every leg`);
      else if (artifactNames.has(name)) fail(`release.yml: artifact ${name} is uploaded by ${artifactNames.get(name)} and ${id}`);
      else artifactNames.set(name, id);
    }
  }
  if (!jobs.release || !jobs.npm) fail("release.yml: no release or npm job");
  if (jobs.release && ![jobs.release.needs ?? []].flat().includes("install-test")) fail("release.yml: the release job does not wait for the install test");
  if (jobs.npm && ![jobs.npm.needs ?? []].flat().includes("release")) fail("release.yml: the npm job does not wait for the release job");

  // The verify step, as written, for each way the workflow can start.
  const verify = step("verify", "Version and mode");
  if (verify && process.platform !== "win32") {
    const current = execFileSync("node", [join(repo, "npm/set-version.mjs"), "--print"], { encoding: "utf8" }).trim();
    const out = mkdtempSync(join(tmpdir(), "drift-ci-verify-"));
    for (const [what, env, ok, publish] of [
      ["a rehearsal", { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REF_NAME: "main", DRY_RUN: "true" }, true, "false"],
      ["a manual run with dry_run off", { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: `refs/tags/v${current}`, GITHUB_REF_NAME: `v${current}`, DRY_RUN: "false" }, false],
      ["the matching tag", { GITHUB_EVENT_NAME: "push", GITHUB_REF: `refs/tags/v${current}`, GITHUB_REF_NAME: `v${current}`, DRY_RUN: "" }, true, "true"],
      ["a tag that does not match the files", { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v9.9.9", GITHUB_REF_NAME: "v9.9.9", DRY_RUN: "" }, false],
      ["a branch push", { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main", GITHUB_REF_NAME: "main", DRY_RUN: "" }, false],
    ]) {
      const file = join(out, "output");
      writeFileSync(file, "");
      const r = spawnSync("bash", ["-e", "-c", verify.run], { cwd: repo, encoding: "utf8", env: { ...process.env, ...env, GITHUB_OUTPUT: file } });
      if ((r.status === 0) !== ok) fail(`release.yml verify, ${what}: exit ${r.status} (${(r.stdout + r.stderr).trim().split("\n").at(-1)})`);
      if (ok) {
        const o = Object.fromEntries(readFileSync(file, "utf8").trim().split("\n").map((l) => l.split("=")));
        if (o.publish !== publish || o.version !== current || o.tag !== `v${current}`) fail(`release.yml verify, ${what}: outputs ${JSON.stringify(o)}`);
      }
    }
    rmSync(out, { recursive: true, force: true });
  }
}

// 3. Versions and names agree, so a release tag passes release.yml's verify job
//    and the npm wrapper, the plugin and the Action all point at one repository.
{
  const r = spawnSync("node", [join(repo, "npm/set-version.mjs"), "--check"], { encoding: "utf8" });
  if (r.status !== 0) fail(`versions disagree:\n${r.stderr.trim()}`);
}
const cargoToml = readFileSync(join(repo, "Cargo.toml"), "utf8");
// The [workspace.package] table: from its header to the next table header (a line
// starting with `[`), so bracketed values such as `authors = ["..."]` stay inside it.
const workspacePackage = /^\[workspace\.package\][ \t]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(cargoToml)?.[1] ?? "";
const workspaceKey = (key) => new RegExp(`^${key}[ \\t]*=[ \\t]*"([^"]*)"`, "m").exec(workspacePackage)?.[1];
const pluginDir = "integrations/claude-code";
const plugin = JSON.parse(readFileSync(join(repo, pluginDir, ".claude-plugin/plugin.json"), "utf8"));
const market = JSON.parse(readFileSync(join(repo, ".claude-plugin/marketplace.json"), "utf8"));
const entry = market.plugins?.find((p) => p.name === plugin.name);
if (!entry) fail(`marketplace.json: no plugin named ${plugin.name}`);
else if (entry.source !== `./${pluginDir}`) fail(`marketplace.json: ${entry.name} source is ${entry.source}, not ./${pluginDir}`);
const hooksJson = JSON.parse(readFileSync(join(repo, pluginDir, "hooks/hooks.json"), "utf8"));
for (const [event, groups] of Object.entries(hooksJson.hooks ?? {})) {
  for (const h of groups.flatMap((g) => g.hooks ?? [])) {
    // The hooks run whatever `drift` is on PATH: the npm package's bin name.
    if (h.command !== `drift hook claude ${event}`) fail(`hooks.json: ${event} runs ${JSON.stringify(h.command)}`);
  }
}
const repoUrl = config.repository;
for (const [where, url] of [
  ["Cargo.toml repository", workspaceKey("repository")],
  ["plugin.json repository", plugin.repository],
  ["plugin.json homepage", plugin.homepage],
]) {
  if (url !== repoUrl) fail(`${where} is ${url}, npm/config.json says ${repoUrl}`);
}
for (const rel of ["action.yml", "npm/launcher/drift.js", "RELEASING.md"]) {
  const urls = readFileSync(join(repo, rel), "utf8").match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/g) ?? [];
  for (const u of urls) if (u.replace(/\.git$/, "") !== repoUrl) fail(`${rel}: ${u} is not ${repoUrl}`);
}
for (const rel of ["LICENSE", "README.md"]) {
  if (!existsSync(join(repo, rel))) fail(`${rel} is missing (every npm package ships it)`);
}

// 4 and 5: release.yml's steps, run in a scratch directory laid out like the
// workflow's checkout (npm/ is this checkout's).
const work = mkdtempSync(join(tmpdir(), "drift-ci-check-"));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });
const host = `${process.platform}-${process.arch}`;
const scope = config.name.replace("@", "").replace("/", "-");
const CI = "0.0.0-ci";
const asCheckout = (dir) => {
  mkdirSync(dir, { recursive: true });
  symlinkSync(join(repo, "npm"), join(dir, "npm"), "dir");
};
const stubDist = (dir) => {
  for (const [target, t] of Object.entries(config.targets)) {
    mkdirSync(join(dir, "dist", target), { recursive: true });
    const exe = join(dir, "dist", target, t.exe);
    writeFileSync(exe, t.suffix === host ? `#!/bin/sh\nif [ "$*" = --version ]; then echo "drift ${CI}"; else echo "drift-stub $*"; fi\n` : "stub\n");
    // Executable bit removed: artifacts do not keep it.
    chmodSync(exe, 0o644);
  }
};
const stepRun = (s, cwd, env) => run("bash", ["-e", "-c", s.run], { cwd, env: { ...process.env, ...env } });
try {
  if (process.platform === "win32") throw new Error("ci-check runs release.yml's bash steps on Linux or macOS");
  asCheckout(work);
  stubDist(work);

  // The package job's version check on the built binary: passes on the tag's
  // version, fails on any other.
  const versionStep = step("package", "The binary reports the tag version");
  if (versionStep) {
    const vdir = join(work, "version-step");
    mkdirSync(join(vdir, "dist/x86_64-unknown-linux-musl"), { recursive: true });
    writeFileSync(join(vdir, "dist/x86_64-unknown-linux-musl/drift"), '#!/bin/sh\necho "drift 9.9.9"\n');
    for (const [ref, ok] of [["v9.9.9", true], ["v9.9.8", false]]) {
      const r = spawnSync("bash", ["-e", "-c", versionStep.run], { cwd: vdir, stdio: "ignore", env: { ...process.env, RELEASE_TAG: ref } });
      if ((r.status === 0) !== ok) fail(`release.yml version step: ${ref} against a binary saying 9.9.9 ${r.status === 0 ? "passed" : "failed"}`);
    }
  }

  // The archive step: one archive per target, SHA256SUMS, executable binaries.
  const archive = step("package", "Archive and checksum");
  if (archive) {
    stepRun(archive, work, { RELEASE_TAG: `v${CI}` });
    const sums = readFileSync(join(work, "out", "SHA256SUMS"), "utf8");
    for (const target of Object.keys(config.targets)) {
      const tgz = `drift-v${CI}-${target}.tar.gz`;
      if (!sums.includes(`  ${tgz}\n`)) fail(`SHA256SUMS does not list ${tgz}`);
      const x = join(work, "x", target);
      mkdirSync(x, { recursive: true });
      run("tar", ["-C", x, "-xzf", join(work, "out", tgz)]);
      const exe = config.targets[target].exe;
      if (!(statSync(join(x, exe)).mode & 0o111)) fail(`${tgz}: ${exe} is not executable`);
    }
  }

  // The npm packages: build and pack as the package job does, then check every tarball.
  const packStep = step("package", "Build and pack the npm packages");
  const tarballs = join(work, "npm-tarballs");
  const packageJson = (tgz) => JSON.parse(run("tar", ["-xzOf", tgz, "package/package.json"]));
  if (packStep) {
    stepRun(packStep, work, { VERSION: CI });
    const all = Object.values(config.targets).map((t) => `${config.name}-${t.suffix}`).sort();
    const seen = [];
    for (const f of readdirSync(tarballs).filter((f) => f.endsWith(".tgz"))) {
      const tgz = join(tarballs, f);
      const pj = packageJson(tgz);
      seen.push(pj.name);
      // Exactly these files, nothing else (no scratch, fixtures or eval data).
      const files = run("tar", ["-tzf", tgz]).trim().split("\n").map((p) => p.replace(/^package\//, "")).sort();
      const t = Object.values(config.targets).find((t) => pj.name === `${config.name}-${t.suffix}`);
      const want = (t ? ["LICENSE", `bin/${t.exe}`, "package.json"] : ["LICENSE", "README.md", "bin/drift.js", "package.json"]).sort();
      if (JSON.stringify(files) !== JSON.stringify(want)) fail(`${pj.name}: packs ${JSON.stringify(files)}, want ${JSON.stringify(want)}`);
      if (pj.version !== CI) fail(`${pj.name}: version ${pj.version}`);
      if (pj.scripts) fail(`${pj.name}: has scripts`);
      if (t) {
        if (JSON.stringify(pj.os) !== JSON.stringify([t.os]) || JSON.stringify(pj.cpu) !== JSON.stringify([t.cpu])) fail(`${pj.name}: os/cpu ${pj.os}/${pj.cpu}`);
        if (t.os !== "win32") {
          const mode = run("tar", ["-tvzf", tgz, `package/bin/${t.exe}`]).slice(0, 10);
          if (!mode.includes("x")) fail(`${pj.name}: bin/${t.exe} is not executable in the tarball (${mode})`);
        }
      } else {
        if (pj.bin?.drift !== "bin/drift.js") fail(`${pj.name}: bin.drift is ${pj.bin?.drift}`);
        const opt = Object.keys(pj.optionalDependencies ?? {}).sort();
        if (JSON.stringify(opt) !== JSON.stringify(all)) fail(`${pj.name}: optionalDependencies ${opt}`);
        for (const v of Object.values(pj.optionalDependencies ?? {})) if (v !== CI) fail(`${pj.name}: optional dependency at ${v}`);
      }
    }
    if (JSON.stringify(seen.sort()) !== JSON.stringify([config.name, ...all].sort())) fail(`npm tarballs: ${seen}`);
  }

  // The install-test job's step: offline install of the tarballs, launcher run.
  const installStep = step("install-test", "Install from the tarballs");
  if (installStep && !Object.values(config.targets).some((t) => t.suffix === host)) console.log(`no package for ${host}: launcher not run`);
  else if (installStep) {
    stepRun(installStep, work, { VERSION: CI, RUNNER_TEMP: work });
    const said = run("npx", ["--no-install", "drift", "a", "b c"], { cwd: join(work, "install-test") }).trim();
    if (said !== "drift-stub a b c") fail(`launcher did not pass the arguments through: ${JSON.stringify(said)}`);
  }

  // 5. The npm job's publish step, as written in release.yml, with a stub `npm` first
  //    on PATH (it records its arguments and publishes nothing): platform packages
  //    before the main package, the dist-tag from the tag name, and a re-run skips
  //    what the registry already has.
  const publish = step("npm", "Publish");
  if (publish && packStep) {
    const stub = join(work, "stub-bin");
    mkdirSync(stub);
    writeFileSync(
      join(stub, "npm"),
      '#!/bin/sh\necho "$*" >> "$NPM_LOG"\nif [ "$1" = view ]; then case " $PUBLISHED " in *" $2 "*) echo 1; exit 0 ;; esac; exit 1; fi\n',
    );
    chmodSync(join(stub, "npm"), 0o755);
    for (const [i, [ref, tag, skip]] of [
      [`v${CI}`, "next", false],
      ["v1.2.3", "latest", true],
    ].entries()) {
      const version = ref.slice(1);
      const cwd = join(work, `publish-${i}`);
      asCheckout(cwd);
      stubDist(cwd);
      // Packed with the real npm, published with the stub.
      stepRun(packStep, cwd, { VERSION: version });
      const log = join(work, `npm-${i}.log`);
      writeFileSync(log, "");
      const linux = `${config.name}-linux-x64@${version}`;
      stepRun(publish, cwd, { PATH: `${stub}:${process.env.PATH}`, RELEASE_TAG: ref, NPM_LOG: log, PUBLISHED: skip ? linux : "" });
      const pubs = readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("publish "));
      const expected = Object.keys(config.targets).length + 1 - (skip ? 1 : 0);
      if (pubs.length !== expected) fail(`release.yml publish (${ref}): ${pubs.length} publishes, want ${expected}: ${pubs}`);
      if (!pubs.at(-1)?.startsWith(`publish ./npm-tarballs/${scope}-${version}.tgz `)) fail(`release.yml publish (${ref}): the main package is not published last: ${pubs.at(-1)}`);
      for (const p of pubs) {
        if (!p.endsWith(`--provenance --access public --tag ${tag}`)) fail(`release.yml publish (${ref}): ${p}`);
        if (skip && p.startsWith(`publish ./npm-tarballs/${scope}-linux-x64-`)) fail(`release.yml publish (${ref}): re-published ${linux}, which the registry has`);
      }
    }
  }
} catch (e) {
  fail(`release steps: ${e.message}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  for (const f of failures) console.error(`ci-check: ${f}`);
  process.exit(1);
}
console.log("ci-check: YAML, rehearsal gate, versions, release archive, npm tarballs, install test, launcher and publish step ok");
