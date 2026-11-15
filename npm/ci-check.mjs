// Cheap CI guard for the release path, without building Drift:
//
//   node npm/ci-check.mjs <dir with node_modules/yaml>
//
// 1. Parses action.yml, the workflows and .pre-commit-hooks.yaml, and checks the
//    shape GitHub and pre-commit need (an unquoted `: ` once made action.yml
//    unloadable).
// 2. Runs release.yml's "Archive and checksum" step on stub binaries that lost
//    their executable bit, as artifacts do between jobs, and checks the
//    archived binary is executable.
// 3. Builds the npm packages from the stubs with npm/build.mjs, packs them (exactly
//    the expected files, no install scripts), installs the main package and this
//    platform's package, and runs the launcher, whose stub binary echoes its arguments.
// 4. Versions agree (Cargo.toml, Cargo.lock, plugin.json, marketplace.json), the
//    plugin hooks run `drift`, and every file names the same repository.
// 5. Runs release.yml's npm Publish step with a stub `npm` (publishes nothing):
//    order, dist-tag, and a re-run skipping versions the registry already has.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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

// 4. Versions and names agree, so a release tag passes release.yml's verify job
//    and the npm wrapper, the plugin and the Action all point at one repository.
const cargoToml = readFileSync(join(repo, "Cargo.toml"), "utf8");
const cargoVersion = /\[workspace\.package\][^[]*?\nversion = "([^"]*)"/.exec(cargoToml)?.[1];
if (!cargoVersion) fail("Cargo.toml: no [workspace.package] version");
for (const c of ["drift-core", "drift-ts", "drift-py", "drift-mine"]) {
  const v = new RegExp(`\\n${c} = \\{[^}\\n]*version = "([^"]*)"`).exec(cargoToml)?.[1];
  if (v !== cargoVersion) fail(`Cargo.toml: workspace dependency ${c} is ${v}, the workspace is ${cargoVersion}`);
}
const lock = readFileSync(join(repo, "Cargo.lock"), "utf8");
for (const c of ["drift-core", "drift-ts", "drift-py", "drift-mine", "drift-cli"]) {
  const v = new RegExp(`\\nname = "${c}"\\nversion = "([^"]*)"`).exec(lock)?.[1];
  if (v !== cargoVersion) fail(`Cargo.lock: ${c} is ${v}, Cargo.toml is ${cargoVersion} (run cargo update --workspace)`);
}
const pluginDir = "integrations/claude-code";
const plugin = JSON.parse(readFileSync(join(repo, pluginDir, ".claude-plugin/plugin.json"), "utf8"));
if (plugin.version !== cargoVersion) fail(`plugin.json: version ${plugin.version}, Cargo.toml ${cargoVersion} (node npm/set-version.mjs)`);
const market = JSON.parse(readFileSync(join(repo, ".claude-plugin/marketplace.json"), "utf8"));
const entry = market.plugins?.find((p) => p.name === plugin.name);
if (!entry) fail(`marketplace.json: no plugin named ${plugin.name}`);
else {
  if (entry.source !== `./${pluginDir}`) fail(`marketplace.json: ${entry.name} source is ${entry.source}, not ./${pluginDir}`);
  if (entry.version !== undefined && entry.version !== plugin.version) fail(`marketplace.json: version ${entry.version}, plugin.json ${plugin.version}`);
}
const hooksJson = JSON.parse(readFileSync(join(repo, pluginDir, "hooks/hooks.json"), "utf8"));
for (const [event, groups] of Object.entries(hooksJson.hooks ?? {})) {
  for (const h of groups.flatMap((g) => g.hooks ?? [])) {
    // The hooks run whatever `drift` is on PATH: the npm package's bin name.
    if (h.command !== `drift hook claude ${event}`) fail(`hooks.json: ${event} runs ${JSON.stringify(h.command)}`);
  }
}
const repoUrl = config.repository;
const cargoRepo = /\[workspace\.package\][^[]*?\nrepository = "([^"]*)"/.exec(cargoToml)?.[1];
for (const [where, url] of [
  ["Cargo.toml repository", cargoRepo],
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

const work =mkdtempSync(join(tmpdir(), "drift-ci-check-"));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });
const host = `${process.platform}-${process.arch}`;
try {
  // Stub binaries, executable bit removed (artifacts do not keep it).
  const dist = join(work, "dist");
  for (const [target, t] of Object.entries(config.targets)) {
    mkdirSync(join(dist, target), { recursive: true });
    const exe = join(dist, target, t.exe);
    writeFileSync(exe, t.suffix === host ? '#!/bin/sh\necho "drift-stub $*"\n' : "stub\n");
    chmodSync(exe, 0o644);
  }

  // 2. The release job's archive step, as written in release.yml.
  const steps = workflows["release.yml"]?.jobs?.release?.steps ?? [];
  const archive = steps.find((s) => s.name === "Archive and checksum");
  if (!archive) {
    fail("release.yml: no 'Archive and checksum' step in the release job");
  } else {
    run("bash", ["-e", "-c", archive.run], { cwd: work, env: { ...process.env, GITHUB_REF_NAME: "v0.0.0-ci" } });
    const sums = readFileSync(join(work, "out", "SHA256SUMS"), "utf8");
    for (const target of Object.keys(config.targets)) {
      const tgz = `drift-v0.0.0-ci-${target}.tar.gz`;
      if (!sums.includes(tgz)) fail(`SHA256SUMS does not list ${tgz}`);
      const x = join(work, "x", target);
      mkdirSync(x, { recursive: true });
      run("tar", ["-C", x, "-xzf", join(work, "out", tgz)]);
      const exe = config.targets[target].exe;
      if (!(statSync(join(x, exe)).mode & 0o111)) fail(`${tgz}: ${exe} is not executable`);
    }
  }

  // The release job's version check on the built binary: passes on the tag's
  // version, fails on any other.
  const versionStep = steps.find((s) => s.name === "The binary reports the tag version");
  if (!versionStep) {
    fail("release.yml: no 'The binary reports the tag version' step in the release job");
  } else if (process.platform !== "win32") {
    const vdir = join(work, "version-step");
    mkdirSync(join(vdir, "dist/x86_64-unknown-linux-musl"), { recursive: true });
    writeFileSync(join(vdir, "dist/x86_64-unknown-linux-musl/drift"), '#!/bin/sh\necho "drift 9.9.9"\n');
    for (const [ref, ok] of [["v9.9.9", true], ["v9.9.8", false]]) {
      let passed = true;
      try {
        execFileSync("bash", ["-e", "-c", versionStep.run], { cwd: vdir, stdio: "ignore", env: { ...process.env, GITHUB_REF_NAME: ref } });
      } catch {
        passed = false;
      }
      if (passed !== ok) fail(`release.yml version step: ${ref} against a binary saying 9.9.9 ${passed ? "passed" : "failed"}`);
    }
  }

  // 3. npm packages: build, pack, install, run the launcher.
  const out = join(work, "npm-out");
  run("node", [join(repo, "npm/build.mjs"), "0.0.0-ci", dist, out]);
  const packs = join(work, "packs");
  mkdirSync(packs);
  for (const d of readdirSync(out)) {
    const [info] = JSON.parse(run("npm", ["pack", "--json", join(out, d)], { cwd: packs }));
    // Exactly these files, nothing else (no scratch, fixtures or eval data).
    const files = info.files.map((f) => f.path).sort();
    const t = Object.values(config.targets).find((t) => info.name === `${config.name}-${t.suffix}`);
    const want = (t ? ["LICENSE", `bin/${t.exe}`, "package.json"] : ["LICENSE", "README.md", "bin/drift.js", "package.json"]).sort();
    if (JSON.stringify(files) !== JSON.stringify(want)) fail(`${info.name}: packs ${JSON.stringify(files)}, want ${JSON.stringify(want)}`);
    if (info.version !== "0.0.0-ci") fail(`${info.name}: version ${info.version}`);
    if (t) {
      const pj = JSON.parse(readFileSync(join(out, d, "package.json"), "utf8"));
      if (JSON.stringify(pj.os) !== JSON.stringify([t.os]) || JSON.stringify(pj.cpu) !== JSON.stringify([t.cpu])) fail(`${info.name}: os/cpu ${pj.os}/${pj.cpu}`);
      if (pj.scripts) fail(`${info.name}: has scripts`);
    } else {
      const pj = JSON.parse(readFileSync(join(out, d, "package.json"), "utf8"));
      if (pj.bin?.drift !== "bin/drift.js") fail(`${info.name}: bin.drift is ${pj.bin?.drift}`);
      if (pj.scripts) fail(`${info.name}: has scripts`);
      const opt = Object.keys(pj.optionalDependencies ?? {}).sort();
      const all = Object.values(config.targets).map((t) => `${config.name}-${t.suffix}`).sort();
      if (JSON.stringify(opt) !== JSON.stringify(all)) fail(`${info.name}: optionalDependencies ${opt}`);
      for (const v of Object.values(pj.optionalDependencies ?? {})) if (v !== "0.0.0-ci") fail(`${info.name}: optional dependency at ${v}`);
    }
  }
  const scope = config.name.replace("@", "").replace("/", "-");
  const project = join(work, "project");
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), '{ "name": "ci-check", "private": true }\n');
  if (Object.values(config.targets).some((t) => t.suffix === host)) {
    run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", join(packs, `${scope}-${host}-0.0.0-ci.tgz`), join(packs, `${scope}-0.0.0-ci.tgz`)], { cwd: project });
    const said = run("npx", ["--no-install", "drift", "--version"], { cwd: project }).trim();
    if (said !== "drift-stub --version") fail(`launcher ran the wrong thing: ${JSON.stringify(said)}`);
  } else {
    console.log(`no package for ${host}: launcher not run`);
  }

  // 5. The npm job's publish step, as written in release.yml, with a stub `npm` first
  //    on PATH (it records its arguments and publishes nothing): platform packages
  //    before the main package, the dist-tag from the tag name, and a re-run skips
  //    what the registry already has.
  const publish = workflows["release.yml"]?.jobs?.npm?.steps?.find((s) => s.name?.startsWith("Publish"));
  if (!publish) {
    fail("release.yml: no Publish step in the npm job");
  } else if (process.platform !== "win32") {
    const stub = join(work, "stub-bin");
    mkdirSync(stub);
    writeFileSync(
      join(stub, "npm"),
      '#!/bin/sh\necho "$*" >> "$NPM_LOG"\nif [ "$1" = view ]; then case " $PUBLISHED " in *" $2 "*) echo 1; exit 0 ;; esac; exit 1; fi\n',
    );
    chmodSync(join(stub, "npm"), 0o755);
    const linux = `${config.name}-linux-x64@0.0.0-ci`;
    for (const [i, [ref, tag, skip]] of [
      ["v0.0.0-ci", "next", false],
      ["v1.2.3", "latest", true],
    ].entries()) {
      const version = ref.slice(1);
      const cwd = join(work, `publish-${i}`);
      run("node", [join(repo, "npm/build.mjs"), version, dist, join(cwd, "npm-out")]);
      const log = join(work, `npm-${i}.log`);
      writeFileSync(log, "");
      const linux = `${config.name}-linux-x64@${version}`;
      run("bash", ["-e", "-c", publish.run], {
        cwd,
        env: { ...process.env, PATH: `${stub}:${process.env.PATH}`, GITHUB_REF_NAME: ref, NPM_LOG: log, PUBLISHED: skip ? linux : "" },
      });
      const pubs = readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("publish "));
      const expected = Object.keys(config.targets).length + 1 - (skip ? 1 : 0);
      if (pubs.length !== expected) fail(`release.yml publish (${ref}): ${pubs.length} publishes, want ${expected}: ${pubs}`);
      if (!pubs.at(-1)?.startsWith("publish npm-out/main ")) fail(`release.yml publish (${ref}): the main package is not published last`);
      for (const p of pubs) {
        if (!p.endsWith(`--provenance --access public --tag ${tag}`)) fail(`release.yml publish (${ref}): ${p}`);
        if (skip && p.startsWith("publish npm-out/linux-x64")) fail(`release.yml publish (${ref}): re-published ${linux}, which the registry has`);
      }
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  for (const f of failures) console.error(`ci-check: ${f}`);
  process.exit(1);
}
console.log("ci-check: YAML, versions, release archive, npm packages, launcher and publish step ok");
