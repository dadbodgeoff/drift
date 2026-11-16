// Shared helpers for the precision study scripts (no dependencies).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LABELS = ["ACCEPT", "TRIVIAL", "WRONG"];
export const TRIVIAL_BY = ["build", "types", "framework", "lint", "tautology"];
// For trivial_by "lint": "error", or "warn_enforced" (warnings fail CI or a pre-commit hook, cited in trivial_evidence).
export const LINT_SEVERITY = ["error", "warn_enforced"];
export const WRONG_BECAUSE = [
  "misdescribes", // the rule is false for the example or for members
  "false_outliers", // most listed outliers actually follow the rule
  "mixed_group", // the group mixes unlike symbols
  "legit_outliers", // outliers are legitimately different, as a recurring category
  "incidental", // true, but a coincidence, not a choice; flags on new code would be noise
  "team_disabled", // the repo's own config turns the matching lint rule off
];
export const MATCH = ["FULL", "PARTIAL", "NONE"];

// ---------- CLI ----------

// parseArgs(argv, { flags: ["x"], defaults: { y: 1 } }) -> { x: true, y: "..", _: [...] }
export function parseArgs(argv, { flags = [], defaults = {} } = {}) {
  const out = { ...defaults, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const key = (eq > 0 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (eq > 0) out[key] = a.slice(eq + 1);
    else if (flags.includes(key)) out[key] = true;
    else {
      if (i + 1 >= argv.length) die(`missing value for ${a}`);
      out[key] = argv[++i];
    }
  }
  return out;
}

export function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(2);
}

// ---------- files ----------

// Parse errors never echo the input. V8's JSON.parse messages quote the text around the error, and these files
// include held-out manifests, so a message says only which file, and the line and column when V8 gives them.
export const repoRootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export function shownPath(path) {
  const r = relative(repoRootDir, resolve(String(path)));
  return r && !r.startsWith("..") && !isAbsolute(r) ? r : String(path);
}
function jsonWhere(e) {
  const msg = String(e?.message ?? "");
  const lc = msg.match(/\(line (\d+) column (\d+)\)/);
  if (lc) return ` (line ${lc[1]}, column ${lc[2]})`;
  const pos = msg.match(/at position (\d+)/);
  return pos ? ` (at position ${pos[1]})` : "";
}
export class SafeParseError extends Error {}
// JSON.parse with a message that carries no part of the text: `where` names the source (a file, a git object).
export function parseJson(text, where) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new SafeParseError(`${where}: invalid JSON${jsonWhere(e)}`);
  }
}
export function readJson(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    die(`cannot read ${shownPath(path)} (${e.code ?? "read error"})`);
  }
  try {
    return parseJson(text, shownPath(path));
  } catch (e) {
    die(e.message);
  }
}

// onError(message) is called for an unparseable line instead of exiting (collect.mjs marks the file INVALID).
export function readJsonl(path, { onError } = {}) {
  const out = [];
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith("//")) return;
      try {
        out.push({ ...JSON.parse(t), _src: `${path}:${i + 1}` });
      } catch (e) {
        const msg = `${shownPath(path)}:${i + 1}: invalid JSON${jsonWhere(e).replace(/line \d+, /, "")}`;
        if (onError) onError(msg);
        else die(msg);
      }
    });
  return out;
}

// All records of every *.jsonl in a directory (or one file).
export function readJsonlAll(pathOrDir) {
  if (!existsSync(pathOrDir)) return [];
  if (statSync(pathOrDir).isFile()) return readJsonl(pathOrDir);
  return readdirSync(pathOrDir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .flatMap((f) => readJsonl(join(pathOrDir, f)));
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export const strip = (rec) => Object.fromEntries(Object.entries(rec).filter(([k]) => !k.startsWith("_")));

// sha256 of a label set (uid -> record, as indexLabels returns): every field of every record, in uid order. agree.mjs
// records it for A and B, adjudicate.mjs requires the agreement's to equal the labels it queues, and --merge
// requires the queue's to equal the labels it merges: agreement first, on exactly the labels C is shown.
export const labelSetSha256 = (M) => createHash("sha256").update(JSON.stringify([...M.keys()].sort().map((k) => strip(M.get(k))))).digest("hex");

// ---------- run directories ----------

export function loadRun(runDir) {
  const run = readJson(join(runDir, "run.json"));
  const queue = readJson(join(runDir, "queue.json"));
  const byUid = new Map(queue.items.map((p) => [p.uid, p]));
  return { run, queue, byUid };
}

export const uidOf = (rec) => rec.uid ?? `${rec.repo}/${rec.id}`;

// Map uid -> record, failing on duplicates (one label per labeller per proposal).
export function indexLabels(records, what) {
  const m = new Map();
  for (const r of records) {
    const uid = uidOf(r);
    if (m.has(uid)) die(`${what}: duplicate label for ${uid} (${m.get(uid)._src} and ${r._src})`);
    m.set(uid, r);
  }
  return m;
}

// Validate one label record against the v2 schema (v3 has the same fields). Returns a list of problems.
// expectRubric: the rubric the prompt was rendered with (collect.mjs); the record's `rubric` must name it.
// otherMembers (optional): uid -> the most files the proposal's role can have members in besides its example's and
// outliers' files (memberFileBound). The "other members" rule asks for min(2, that bound) further files; without it
// (or without a bound for the uid) it asks for 2, as before.
// memberFiles (optional): uid -> { tracked: Set, candidates: Set | null } (memberFileInfo). With it, a further file
// counts as an other member only if it is a tracked file of the checkout, is not a config file (CONFIG_FILE), and,
// when the role's files can be bounded, is one of them (roleFileCandidates): a file that cannot hold a member of the
// role is not one of rubric v3's "two other members" (2026-11-07; labellers had padded `checked` with such files).
export function checkLabel(rec, { labeller, byUid, rubric = "v2", expectRubric, otherMembers, memberFiles } = {}) {
  if (String(expectRubric ?? rubric).startsWith("practice-")) return checkPracticeLabel(rec, { labeller, byUid, expectRubric: expectRubric ?? rubric });
  const p = [];
  const uid = uidOf(rec);
  if (!rec.uid) p.push("missing uid");
  if (byUid && !byUid.has(uid)) p.push(`unknown uid ${uid}`);
  if (labeller && rec.labeller !== labeller) p.push(`labeller is ${JSON.stringify(rec.labeller)}, expected ${labeller}`);
  if (!LABELS.includes(rec.label)) p.push(`label ${JSON.stringify(rec.label)} not in ${LABELS.join("|")}`);
  if (typeof rec.clear !== "boolean") p.push("clear must be true/false");
  if (typeof rec.reason !== "string" || rec.reason.trim().length < 10) p.push("reason missing or too short");
  if (expectRubric && rec.rubric !== expectRubric) p.push(`rubric is ${JSON.stringify(rec.rubric)}, but the prompt was rendered with rubric ${expectRubric}`);
  if (rubric === "v2" || rubric === "v3") {
    if (!["high", "low"].includes(rec.confidence)) p.push('confidence must be "high" or "low"');
    if (!Array.isArray(rec.checked) || rec.checked.length < 2) p.push("checked must list at least 2 files opened");
    else if (rec.checked.some((f) => typeof f !== "string" || f.startsWith("/") || f.split("/").includes("..")))
      p.push("checked entries must be repo-relative paths");
    if (rec.label === "TRIVIAL" && !TRIVIAL_BY.includes(rec.trivial_by))
      p.push(`TRIVIAL needs trivial_by in ${TRIVIAL_BY.join("|")}`);
    if (rec.label === "TRIVIAL" && ["lint", "framework", "build", "types"].includes(rec.trivial_by) && !rec.trivial_evidence)
      p.push("TRIVIAL by a tool needs trivial_evidence (config file and rule, or the error)");
    if (rec.label === "WRONG" && !WRONG_BECAUSE.includes(rec.wrong_because))
      p.push(`WRONG needs wrong_because in ${WRONG_BECAUSE.join("|")}`);
    if (rec.label === "TRIVIAL" && rec.trivial_by === "lint" && !LINT_SEVERITY.includes(rec.lint_severity))
      p.push(`TRIVIAL by lint needs lint_severity in ${LINT_SEVERITY.join("|")}`);
    // "What to open": the example, min(3, outlier files) outlier files, and at least two further files.
    const q = byUid?.get(uid);
    const ex = q?.example?.split("#")[0];
    if (q && Array.isArray(rec.checked)) {
      const opened = new Set(rec.checked);
      if (ex && !opened.has(ex)) p.push(`checked does not include the example file ${ex}`);
      if (Array.isArray(q.outlier_files)) {
        const need = Math.min(3, q.outlier_files.length);
        const got = q.outlier_files.filter((f) => opened.has(f));
        if (got.length < need) p.push(`checked covers ${got.length} outlier files, needs ${need} (of ${q.outlier_files.slice(0, 5).join(", ")}${q.outlier_files.length > 5 ? ", ..." : ""})`);
        const base = new Set([ex, ...got]);
        const info = memberFiles?.get(uid);
        const notCounted = [];
        const others = [...opened].filter((f) => {
          if (base.has(f)) return false;
          const why = info ? otherMemberRejection(f, info) : null;
          if (why) notCounted.push(`${f} (${why})`);
          return !why;
        });
        const bound = otherMembers?.get(uid) ?? info?.bound;
        const needOthers = Number.isInteger(bound) ? Math.min(2, bound) : 2;
        if (others.length < needOthers)
          p.push(
            `checked lists ${others.length} files besides the example and outliers, needs ${needOthers} (other members${needOthers < 2 ? `; the role has members in at most ${bound} other files` : ""}); rubric v3 "What to open" 3: open at least two other members of the role, in files other than the example's and the outliers'` +
              (notCounted.length ? `; not counted: ${notCounted.slice(0, 4).join(", ")}${notCounted.length > 4 ? `, and ${notCounted.length - 4} more` : ""}` : ""),
          );
      }
    }
  }
  return p;
}

// Practice labels (F6, PLAN-R14 WS-F; PREREG-R13-practices.md). Two steps per sampled unit:
//   1. describe (rubric practice-describe): a labeller sees the unit and the concern, never Drift's assignment, and
//      writes what the unit does: `does` (DESCRIBE_OUTCOMES) and, when it does the concern, its mechanisms;
//   2. match (rubric practice-match): a matcher sees that description, the assignment and the attributes to check, and
//      says whether the described mechanism is the assigned variant's (`same`), and gives a verdict per attribute.
// The label (PRACTICE_LABELS) follows from the assignment, the description and `same` (derivePracticeLabel).
export const PRACTICE_LABELS = ["CORRECT", "WRONG_VARIANT", "MISSED", "FALSE_NONE", "NOT_IN_POPULATION", "UNSURE"];
export const DESCRIBE_OUTCOMES = ["DOES", "NONE", "CANNOT_TELL", "NOT_IN_POPULATION", "UNSURE"];
export const APART_VERDICTS = ["TRUE", "FALSE", "UNSURE"];
// assigned: "known" | "none" | "unknown"; does: a DESCRIBE_OUTCOMES value; same: the matcher's answer (known + DOES only).
export function derivePracticeLabel(assigned, does, same) {
  if (does === "NOT_IN_POPULATION") return "NOT_IN_POPULATION";
  if (does === "UNSURE" || !DESCRIBE_OUTCOMES.includes(does)) return "UNSURE";
  if (assigned === "known") return does === "DOES" ? (same === true ? "CORRECT" : same === false ? "WRONG_VARIANT" : "UNSURE") : does === "NONE" ? "WRONG_VARIANT" : "UNSURE";
  if (assigned === "none") return does === "NONE" ? "CORRECT" : does === "DOES" ? "FALSE_NONE" : "UNSURE";
  if (assigned === "unknown") return does === "CANNOT_TELL" ? "CORRECT" : does === "DOES" ? "MISSED" : "WRONG_VARIANT";
  return "UNSURE";
}
const checkedProblems = (rec, q) => {
  if (!Array.isArray(rec.checked) || !rec.checked.length) return ["checked must list the files opened"];
  if (rec.checked.some((f) => typeof f !== "string" || f.startsWith("/") || f.split("/").includes(".."))) return ["checked entries must be repo-relative paths"];
  if (q?.unit?.path && !rec.checked.includes(q.unit.path)) return [`checked does not include the unit's file ${q.unit.path}`];
  return [];
};
export const RECALL_CONCERNS = ["authn", "authz", "validation", "errors", "api"];
export const RECALL_MATCHES = ["FOUND", "PARTIAL", "MISSED"];
// The variant-recall records (PREREG-R13-practices.md §6.4): the lister's list per concern, and the matcher's answer per
// listed mechanism (`list`: the lister's collected record, to check the matcher answers each one, in order).
export function checkRecallRecord(rec, { expectRubric, list = null } = {}) {
  const p = [];
  const c = rec.concerns;
  if (!c || typeof c !== "object" || Array.isArray(c)) return ["concerns must be an object with the five primary concerns"];
  const keys = Object.keys(c).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...RECALL_CONCERNS].sort())) p.push(`concerns must have exactly the keys ${RECALL_CONCERNS.join(", ")}`);
  for (const k of RECALL_CONCERNS) {
    if (!Array.isArray(c[k])) {
      p.push(`concerns.${k} must be a list`);
      continue;
    }
    if (expectRubric === PRACTICE_RUBRICS["recall-list"]) {
      for (const m of c[k]) if (!["mechanism", "instrument", "example"].every((f) => typeof m?.[f] === "string" && m[f].trim())) p.push(`concerns.${k}: each mechanism needs mechanism, instrument and example`);
    } else {
      for (const m of c[k]) if (!RECALL_MATCHES.includes(m?.match)) p.push(`concerns.${k}: match ${JSON.stringify(m?.match)} not in ${RECALL_MATCHES.join("|")}`);
      if (list && Array.isArray(list.concerns?.[k]) && list.concerns[k].length !== c[k].length) p.push(`concerns.${k}: ${c[k].length} answers for ${list.concerns[k].length} listed mechanisms`);
    }
  }
  return p;
}
export function checkPracticeLabel(rec, { labeller, byUid, expectRubric, list = null } = {}) {
  const p = [];
  const uid = uidOf(rec);
  const q = byUid?.get(uid);
  if (!rec.uid) p.push("missing uid");
  if (byUid && !q) p.push(`unknown uid ${uid}`);
  if (labeller && rec.labeller !== labeller) p.push(`labeller is ${JSON.stringify(rec.labeller)}, expected ${labeller}`);
  if (expectRubric && rec.rubric !== expectRubric) p.push(`rubric is ${JSON.stringify(rec.rubric)}, but the prompt was rendered with rubric ${expectRubric}`);
  if (typeof rec.reason !== "string" || rec.reason.trim().length < 10) p.push("reason missing or too short");
  if (String(expectRubric).startsWith("practice-recall-")) {
    if (!Array.isArray(rec.checked) || !rec.checked.length || rec.checked.some((f) => typeof f !== "string" || f.startsWith("/") || f.split("/").includes(".."))) p.push("checked must list the repo-relative files opened");
    return [...p, ...checkRecallRecord(rec, { expectRubric, list })];
  }
  p.push(...checkedProblems(rec, q));
  if (expectRubric === PRACTICE_RUBRICS.describe) {
    if (!DESCRIBE_OUTCOMES.includes(rec.does)) p.push(`does ${JSON.stringify(rec.does)} not in ${DESCRIBE_OUTCOMES.join("|")}`);
    if (!["high", "low"].includes(rec.confidence)) p.push('confidence must be "high" or "low"');
    if (rec.does === "DOES") {
      if (!Array.isArray(rec.mechanisms) || !rec.mechanisms.length || rec.mechanisms.some((m) => typeof m?.mechanism !== "string" || !m.mechanism.trim() || typeof m?.instrument !== "string" || !m.instrument.trim()))
        p.push("DOES needs `mechanisms`: [{ mechanism, instrument }], each named");
    } else if (rec.mechanisms !== undefined && (!Array.isArray(rec.mechanisms) || rec.mechanisms.length)) p.push(`${rec.does} has no mechanisms: leave \`mechanisms\` out or empty`);
    for (const f of ["label", "same", "apart"]) if (rec[f] !== undefined) p.push(`\`${f}\` is not a field of a description (the describing labeller is not shown the assignment)`);
  } else if (expectRubric === PRACTICE_RUBRICS.match) {
    if (![true, false, null].includes(rec.same)) p.push("same must be true, false or null");
    const needSame = q?.assigned?.kind === "known" && rec.described_does === "DOES";
    if (!DESCRIBE_OUTCOMES.includes(rec.described_does)) p.push("described_does must copy the description's outcome from the card");
    if (needSame && typeof rec.same !== "boolean") p.push("a description that does the concern, for a unit assigned a known variant, needs same: true or false");
    const want = q?.apart ?? [];
    if (!Array.isArray(rec.apart)) p.push(`apart must list a verdict for each of the ${want.length} attributes shown`);
    else {
      for (const a of rec.apart) if (!APART_VERDICTS.includes(a?.verdict)) p.push(`apart verdict ${JSON.stringify(a?.verdict)} not in ${APART_VERDICTS.join("|")}`);
      const names = rec.apart.map((a) => a?.attribute);
      const miss = want.filter((w) => !names.includes(w));
      const extra = names.filter((n) => !want.includes(n));
      if (miss.length) p.push(`apart misses ${miss.join(", ")}`);
      if (extra.length) p.push(`apart names attributes not shown: ${extra.join(", ")}`);
      if (new Set(names).size !== names.length) p.push("apart names an attribute twice");
    }
  } else p.push(`unknown practice rubric ${JSON.stringify(expectRubric)}`);
  return p;
}

// ---------- the files a role's members can be in ----------
// The census names a role's example and outliers, not all its member files. A role whose members all sit in the
// example's and outliers' files (every function of one mutations.tsx) has no "two other member files" to open, so
// the validator asks for min(2, the files the role can have members in besides those). Drift's role membership is
// not re-implemented here: roleFileCandidates over-approximates it from the selector (package, dir prefix with
// dynamic segments, file kind), so the bound is never below the true count and the rule is never loosened for a
// role that has further member files. Model roles are bounded by content (modelFileCandidates); package roles and
// proposals without a role get no bound.
const segs = (p) => p.split("/").filter((s) => s && s !== "."); // "." is the package directory itself
const abstractSeg = (s) => (s.startsWith("[") && s.endsWith("]") ? "[*]" : s);
const PACKAGE_MANIFEST = /(^|\/)(package\.json|pyproject\.toml|setup\.py|setup\.cfg)$/;
// A merged card (round 9 D, #120) covers its own role and each sibling in `role.also` (Drift's RoleSelector::parts):
// its candidates are the union over those parts, and when any part is unbounded the card is too (relabel5: the bound
// read the primary part only, so members in a sibling part were "outside the role").
export function roleFileCandidates(role, files, read) {
  if (!role) return null;
  if (!Array.isArray(role.also) || !role.also.length) return partFileCandidates(role, files, read);
  const { also, ...primary } = role;
  const out = new Set();
  for (const part of [primary, ...also]) {
    const c = partFileCandidates(part, files, read);
    if (!c) return null;
    for (const f of c) out.add(f);
  }
  return files.filter((f) => out.has(f));
}
function partFileCandidates(role, files, read) {
  if (!role || typeof role.dir !== "string" || typeof role.file !== "string") return null;
  if (role.kind === "model") return modelFileCandidates(role, files, read);
  if (role.kind === "package") return null;
  const pkg = segs(role.package ?? "");
  const dir = role.dir === "**" ? null : segs(role.dir);
  const kind = role.file;
  return files.filter((path) => {
    const ps = segs(path);
    if (ps.length <= pkg.length || pkg.some((s, i) => ps[i] !== s)) return false;
    const below = ps.slice(pkg.length);
    const name = below[below.length - 1];
    const dirs = below.slice(0, -1).map(abstractSeg);
    if (dir && (dirs.length < dir.length || dir.some((s, i) => dirs[i] !== s))) return false;
    if (kind === "*") return true;
    if (kind.startsWith("*.")) return name.includes(`.${kind.slice(2)}.`);
    if (kind.includes("/")) return path.includes(`${kind}.`); // a Python layered kind, parent/stem
    if (kind === "[*]") return name.startsWith("[");
    return name.split(".")[0] === kind;
  });
}
// Model roles (`dir` is the model source, `file` "(model)", package ""): Drift finds a model wherever it is declared,
// not only in models.py or models/, so the file name alone would undercount. The bound reads the files instead:
//   - "django": drift-py makes a class a Django model when its body assigns a call whose callee's dotted name ends
//     with Field or ForeignKey and starts with django.db.models., resolved through the file's own imports only (a
//     relative or star import resolves to nothing). So a .py file is a candidate when, at bracket depth 0 (keyword
//     arguments inside a call, such as a migration's `field=models.CharField(...)`, do not count), it assigns a call
//     `name = a.b.XField(` / `XForeignKey(` whose first name is bound by an import from django (`from django.db import
//     models`, `import django.db.models as m`), or a call of a name imported from django as an alias of a Field or
//     ForeignKey. The test is looser than Drift's (any django import, any indentation, imports anywhere in the
//     file), never stricter. A file the scanner cannot follow (unbalanced brackets, an unterminated string) or
//     cannot read is a candidate.
//   - "prisma": every .prisma file.
//   - any other source (sqlalchemy, sqlmodel, drizzle, sql): no bound.
// `read(path)` returns a file's text (or null: the file is then a candidate). Without `read`, no bound.
export function modelFileCandidates(role, files, read) {
  if (!read || (role.package ?? "") !== "") return null;
  if (role.dir === "prisma") return files.filter((f) => f.endsWith(".prisma"));
  if (role.dir !== "django") return null;
  return files.filter((f) => {
    if (!f.endsWith(".py")) return false;
    const text = read(f);
    return text == null || mayDeclareDjangoModel(text);
  });
}
// The logical lines of Python source at bracket depth 0 (continuations joined), or null when the scan cannot follow
// the text. Strings (any prefix, single or triple quoted) and comments are blanked, so brackets inside them do not count.
export function pythonLogicalLines(text) {
  const lines = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const q3 = text.startsWith(c.repeat(3), i);
      const q = q3 ? c.repeat(3) : c;
      let j = i + q.length;
      for (;;) {
        if (j >= text.length) return null;
        if (text[j] === "\\") j += 2;
        else if (text.startsWith(q, j)) break;
        else if (!q3 && text[j] === "\n") return null;
        else j++;
      }
      cur += '""';
      i = j + q.length;
      continue;
    }
    if (c === "\\" && text[i + 1] === "\n") {
      cur += " ";
      i += 2;
      continue;
    }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c) && --depth < 0) return null;
    if (c === "\n" && depth === 0) {
      lines.push(cur);
      cur = "";
    } else cur += c === "\n" ? " " : c;
    i++;
  }
  if (depth !== 0) return null;
  lines.push(cur);
  return lines;
}
const ASSIGNED_CALL = /^(?:\s*class\b[^:]*:)?\s*(?:[A-Za-z_][\w.,\s]*(?::[^=]*)?=\s*)+\(*\s*([A-Za-z_][\w.]*)\s*\(/;
const IS_FIELD = /(?:Field|ForeignKey)$/;
const fromDjango = (m) => m === "django" || m.startsWith("django.");
export function mayDeclareDjangoModel(text) {
  const lines = pythonLogicalLines(text);
  if (!lines) return true;
  const stmts = lines.flatMap((l) => l.split(";")).map((st) => st.replace(/\s*\.\s*/g, "."));
  const bound = new Set(); // names bound by an import from django
  const fieldAliases = new Set(); // names bound to a django ...Field / ...ForeignKey under another name
  for (const st of stmts) {
    let m;
    if ((m = st.match(/^\s*from\s+([\w.]+)\s+import\s+\(?([^)]*)\)?\s*$/)) && fromDjango(m[1])) {
      for (const part of m[2].split(",")) {
        const [name, alias] = part.trim().split(/\s+as\s+/);
        if (!name || name === "*") continue;
        bound.add(alias ?? name);
        if (alias && IS_FIELD.test(name)) fieldAliases.add(alias);
      }
    } else if ((m = st.match(/^\s*import\s+(.+)$/))) {
      for (const part of m[1].split(",")) {
        const [mod, alias] = part.trim().split(/\s+as\s+/);
        if (mod && fromDjango(mod)) bound.add(alias ?? mod.split(".")[0]);
      }
    }
  }
  return stmts.some((st) => {
    const m = st.match(ASSIGNED_CALL);
    if (!m) return false;
    const callee = m[1];
    return (IS_FIELD.test(callee) && bound.has(callee.split(".")[0])) || fieldAliases.has(callee);
  });
}
// Lint, compiler, package and framework configs (rubric v3 "What to open" 4, and their usual neighbours): a labeller
// lists them in `checked` when TRIVIAL is in question, but they hold no member of a role.
export const CONFIG_FILE =
  /(^|\/)(eslint\.config\.[^/]*|\.eslintrc[^/]*|\.oxlintrc\.json|biome\.jsonc?|tsconfig[^/]*\.json|jsconfig[^/]*\.json|package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|bun\.lockb?|turbo\.json|nest-cli\.json|(next|vite|vitest|jest|webpack|babel|prettier|tailwind|postcss|svelte|astro|nuxt|remix|drizzle)\.config\.[^/]*|\.babelrc[^/]*|\.prettierrc[^/]*|ruff\.toml|\.ruff\.toml|\.flake8|\.pylintrc|pylintrc|mypy\.ini|\.mypy\.ini|\.importlinter|pyproject\.toml|setup\.cfg|setup\.py|tox\.ini|requirements[^/]*\.txt|poetry\.lock|uv\.lock|Pipfile(\.lock)?|\.pre-commit-config\.yaml)$/;
// Why a further `checked` file is not counted as an other member (null: it counts). info: memberFileInfo's entry.
export function otherMemberRejection(f, info) {
  if (info.tracked && !info.tracked.has(f)) return "not a tracked file of the checkout";
  // A file the role itself can have members in counts even when it is a config file: the members of a role over
  // package manifests (`package.json`, `pyproject.toml`) are such files (relabel4, 2026-11-07).
  if (info.candidates && info.candidates.has(f)) return null;
  if (info.packageRole && PACKAGE_MANIFEST.test(f)) return null;
  if (CONFIG_FILE.test(f)) return "a config file";
  if (info.candidates && !info.candidates.has(f)) return "cannot hold a member of the role: outside its package, directory or file kind";
  return null;
}
// The most files a proposal's role can have members in, besides its example's and outliers' files; null if unknown.
export function memberFileBound(q, files, read) {
  const c = roleFileCandidates(q?.role, files, read);
  if (!c) return null;
  const skip = new Set([q.example?.split("#")[0], ...(q.outlier_files ?? [])]);
  return c.filter((f) => !skip.has(f)).length;
}
// uid -> memberFileBound, from the tracked files of each repo's checkout (run.json repos[].checkout). A repo whose
// checkout is missing or not readable gets no bounds (the rule then asks for 2).
export function otherMemberBounds(run, queue) {
  const out = new Map();
  for (const [uid, info] of memberFileInfo(run, queue)) if (info.bound !== null) out.set(uid, info.bound);
  return out;
}
// uid -> { tracked: Set of the checkout's tracked files, candidates: Set of the role's candidate files or null,
// bound: memberFileBound or null }, for checkLabel's memberFiles. A repo whose checkout is missing or not readable
// gets no entry (then only the count of further files is checked, as before).
export function memberFileInfo(run, queue) {
  const out = new Map();
  for (const r of run.repos ?? []) {
    if (!r.checkout || !existsSync(join(r.checkout, ".git"))) continue;
    const ls = spawnSync("git", ["-C", r.checkout, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 });
    if (ls.status !== 0) continue;
    const files = ls.stdout.split("\0").filter(Boolean);
    const read = (f) => {
      try {
        return readFileSync(join(r.checkout, f), "utf8");
      } catch {
        return null;
      }
    };
    const tracked = new Set(files);
    for (const q of queue.items.filter((p) => p.repo === r.name)) {
      const c = roleFileCandidates(q?.role, files, read);
      const skip = new Set([q.example?.split("#")[0], ...(q.outlier_files ?? [])]);
      out.set(q.uid, { tracked, candidates: c ? new Set(c) : null, bound: c ? c.filter((f) => !skip.has(f)).length : null, packageRole: q.role?.kind === "package" });
    }
  }
  return out;
}

// ---------- agents' working directories and checkouts ----------
const realOrResolved = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
export const within = (dir, root) => {
  const r = relative(realOrResolved(root), realOrResolved(dir));
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};
// Why `dir` is not a neutral place for an agent's working directory ([] if it is): inside a git work tree (any
// checkout or worktree, Drift's included), the Drift repository, the run directory, a repo checkout or the outbox root.
export function neutralDirProblems(dir, { runDir, outboxRoot, checkouts = [] } = {}) {
  const p = [];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  let probe = resolve(dir); // the nearest existing directory: `dir` itself may not exist yet
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: probe, encoding: "utf8", env });
  if (top.status === 0) p.push(`it is inside the git work tree ${top.stdout.trim()}`);
  const isDrift = existsSync(join(repoRootDir, "Cargo.toml")) && existsSync(join(repoRootDir, "eval", "study"));
  if (isDrift && within(dir, repoRootDir)) p.push("it is inside the Drift repository");
  if (runDir && within(dir, runDir)) p.push("it is inside the run directory");
  if (outboxRoot && within(dir, outboxRoot)) p.push("it is inside the outbox root");
  for (const c of checkouts) if (within(dir, c)) p.push(`it is inside the checkout ${c}`);
  return p;
}
// A checkout's `git status --porcelain` lines (untracked and ignored files included, Drift's .drift/ cache left out),
// sorted; null when there is no checkout. prompt.mjs records it, collect.mjs compares.
export function checkoutStatus(checkout) {
  if (!checkout || !existsSync(join(checkout, ".git"))) return null;
  // GIT_OPTIONAL_LOCKS=0: a status never refreshes the index of a read-only clone
  const r = spawnSync("git", ["-C", checkout, "status", "--porcelain", "--untracked-files=all", "--ignored", "-z"], { encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (r.status !== 0) return null;
  return r.stdout
    .split("\0")
    .filter(Boolean)
    .filter((l) => !/^.. \.drift(\/|$)/.test(l))
    .sort();
}

// ---------- label-set completeness ----------
// The A and B label sets a run still lacks, per (labeller, repo with proposals in the queue): proposals without a
// record, and prompts that are rendered but not collected (an agent still working, or an output not yet validated).
// sets: optional { A: Map, B: Map } already loaded (agree.mjs --a/--b); otherwise <run>/labels/<L>/.
// skipRepos: repos left out by a recorded adjudication exclusion (adjudicate.mjs --exclude-repos).
// useIndex: false for label sets from elsewhere (agree.mjs --a/--b), whose prompts are not the run's.
export function labelSetGaps(runDir, queue, { sets = {}, labellers = ["A", "B"], skipRepos = [], useIndex = true } = {}) {
  const idxPath = join(runDir, "prompts", "index.json");
  const index = useIndex && existsSync(idxPath) ? readJson(idxPath) : [];
  const repos = [...new Set(queue.items.map((p) => p.repo))].filter((r) => !skipRepos.includes(r));
  const gaps = [];
  for (const L of labellers) {
    const have = sets[L] ? new Set(sets[L].keys()) : new Set(readJsonlAll(join(runDir, "labels", L)).map(uidOf));
    for (const repo of repos) {
      const want = queue.items.filter((p) => p.repo === repo).map((p) => p.uid);
      const missing = want.filter((u) => !have.has(u));
      const e = index.find((x) => x.stage === "label" && x.labeller === L && x.repo === repo);
      const state = e && !e.collected ? "prompt rendered, output not collected" : !e && missing.length === want.length && index.some((x) => x.stage === "label") ? "no prompt rendered" : null;
      if (missing.length || state) gaps.push({ labeller: L, repo, labelled: want.length - missing.length, of: want.length, ...(state ? { state } : {}) });
    }
  }
  return gaps;
}
export const describeGap = (g) => `${g.labeller} ${g.repo}: ${g.labelled} of ${g.of} labelled${g.state ? ` (${g.state})` : ""}`;
// The repos an adjudication queue records as excluded (adjudicate.mjs --exclude-repos), or [].
export function excludedRepos(runDir) {
  const q = join(runDir, "adjudication", "queue.json");
  return existsSync(q) ? readJson(q).excluded?.repos ?? [] : [];
}
// --allow-incomplete TEXT: the override of a completeness refusal. Returns the record to write into the output, or
// dies with the refusal when there are gaps and no reason. `what` names the script's step for the message.
export function completenessOverride(gaps, allow, what) {
  if (!gaps.length) {
    if (allow !== undefined) die(`--allow-incomplete: every A and B label set is complete; drop the flag`);
    return null;
  }
  const list = gaps.map(describeGap);
  if (allow === undefined || allow === true)
    die(`${what} needs complete A and B label sets; ${gaps.length} are not:\n  ${list.join("\n  ")}\nCollect the missing outputs first (collect.mjs --complete). To go on anyway, pass --allow-incomplete TEXT (why; recorded in the output and to be reported as a deviation)`);
  if (String(allow).trim().length < 10) die("--allow-incomplete needs a reason of at least 10 characters (it is recorded in the output)");
  return { reason: String(allow).trim(), gaps: list, at: new Date().toISOString() };
}

// ---------- drift output ----------

// `drift census` text lists the default tier and only the best few suggestions by default since round 8 (W4,
// crates/drift-mine/src/rank.rs); the study reads every proposal, so it passes `--all` to a binary that has the
// flag. A binary from before (a frozen product) lists every proposal and has no such flag: nothing is passed.
export function censusListAll(drift) {
  const r = spawnSync(drift, ["census", "--help"], { encoding: "utf8", maxBuffer: 1 << 24 });
  return r.status === 0 && /^\s+--all\s/m.test(r.stdout ?? "") ? ["--all"] : [];
}

// What a labeller (A, B, C) is shown of one census block: the block without its rank and without the `agents:` line.
// The census prints that line since round 9 (W0, #110): whether agents are shown the convention and, when they are
// not, the family's labelled accept rate on the latest dev run ("family below admission bar: 56% of 37"). That rate is
// derived from earlier labels, so a labeller must never see it (blinding, relabel5); the verifier's card drops it too
// (crates/drift-mine/src/verify.rs card_block).
// A practice item (kind "practice", practices.mjs sample) is rendered as its own card: the concern, the unit, the
// assigned variant's label, mechanisms and instruments, and the "what sets it apart" attributes to check. Never its
// share, member counts, variant id, dominance or the Wilson counts of sets_apart: what the tool's numbers say must not
// steer the label (blinding, as for the census rank and the agents line).
//
// F1 (PLAN-R14 WS-F, rubric v4 on): the card also loses Drift's confidence: the `evidence:` line (counts, Wilson lower
// bound, lift), the counts of the `split:` line, and "N members" / "N of M" counts anywhere. The rule, the example and
// the outliers stay. Earlier rubrics keep the card they were labelled with (past sets are not re-read).
export const EVIDENCE_FREE_RUBRICS = ["v4"];
export function labellerCard(block, { rubric = null, match = null, list = null } = {}) {
  if (block && typeof block === "object" && block.kind === "practice") return practiceCard(block, { match });
  if (block && typeof block === "object" && block.kind === "practice-recall") return recallCard(block, { list });
  const card = String(block)
    .replace(/^\s*\d+\. /, "")
    .replace(/\n[ \t]+agents:[ \t][^\n]*/g, "");
  if (!EVIDENCE_FREE_RUBRICS.includes(rubric)) return card;
  return card
    .replace(/\n[ \t]+evidence:[ \t][^\n]*/g, "")
    .replace(/^([ \t]+split:[ \t]+)(.*)$/gm, (_, head, list) => head + list.split(/,\s*/).map((x) => x.replace(/\s+\d+$/, "")).join(", "))
    .replace(/\s*\(\d+ members?\b[^)]*\)/g, "")
    .replace(/\b\d+ of \d+\b/g, "some");
}

// A practice item's cards (F6). The describe card: the concern, the population and the unit, nothing of Drift's
// assignment. The match card (opts.match: the collected description of one labeller): the same, the description, the
// assignment (label, mechanisms, instruments) and the attributes to check. Neither shows a share, a count, a variant
// id, which variant is dominant or which attributes are controls.
function practiceCard(item, { match = null } = {}) {
  const u = item.unit ?? {};
  const where = `${u.path ?? "?"}${u.line ? `:${u.line}` : ""}${u.symbol ? ` (${u.symbol})` : ""}`;
  const lines = [`concern:  ${item.concern}${item.concern_title ? ` (${item.concern_title})` : ""}`, `unit:     ${item.unit_kind ?? "unit"} at ${where}`];
  if (!match) return lines.join("\n");
  lines.push(`described: ${match.does ?? "?"}${match.mechanisms?.length ? `: ${match.mechanisms.map((m) => `${m.mechanism} ${m.instrument}`).join("; ")}` : ""}`);
  if (match.description) lines.push(`  description: ${String(match.description).replace(/\s+/g, " ")}`);
  const a = item.assigned ?? {};
  const what =
    a.kind === "unknown"
      ? `unknown: the tool could not tell how this unit handles the concern${a.reason ? ` (its reason: ${a.reason})` : ""}`
      : `${a.label ?? "?"} (${a.kind === "none" ? "none: a recorded absence" : "a known variant"})`;
  lines.push(`assigned: ${what}`);
  if (a.mechanisms?.length) lines.push(`  mechanisms:  ${a.mechanisms.join(", ")}`);
  if (a.instruments?.length) lines.push(`  instruments: ${a.instruments.join(", ")}`);
  if (a.kind === "unknown" && a.instrument) lines.push(`  instrument:  ${a.instrument}`);
  if (item.apart?.length) {
    lines.push("attributes to check against this unit:");
    for (const at of item.apart) lines.push(`  - ${at}`);
  }
  return lines.join("\n");
}

// A recall package's cards (§6.4). The list card: the package and the five primary concerns, nothing of the tool's. The
// match card (opts.list: the lister's collected record): per concern, the listed mechanisms, numbered, and the tool's
// variants in the package (label, kind, mechanisms, instruments); never a share, a count or a variant id.
function recallCard(item, { list = null } = {}) {
  const lines = [`package:  ${item.package === "" ? "." : item.package}`, `concerns: ${(item.concerns ?? []).join(", ")}`];
  if (!list) return lines.join("\n");
  for (const c of item.concerns ?? []) {
    lines.push(`${c}:`);
    const listed = list.concerns?.[c] ?? [];
    lines.push(listed.length ? "  listed:" : "  listed: (nothing listed)");
    listed.forEach((m, i) => lines.push(`    ${i + 1}. ${m.mechanism} ${m.instrument} (e.g. ${m.example})`));
    const tool = item.drift_variants?.[c] ?? [];
    lines.push(tool.length ? "  tool:" : "  tool: (none in this package)");
    for (const v of tool) lines.push(`    - ${v.label ?? "?"} (${v.kind === "none" ? "none" : "known"})${v.mechanisms?.length ? `; mechanisms: ${v.mechanisms.join(", ")}` : ""}${v.instruments?.length ? `; instruments: ${v.instruments.join(", ")}` : ""}`);
  }
  return lines.join("\n");
}

// The leak check every labelling prompt passes before launch (the brief): no `agents:` line, no "Moves labels" note,
// no "<n>% of <n>" rate; and (F1) no Drift confidence: no `evidence:` line, "lower bound" or "lift <n>"; and, with
// { repo }, no occurrence of the repo's name (check it on the prompt without the cards: source paths may reveal it).
// Returns the problems, [] when clean.
export function promptLeaks(text, { repo = null } = {}) {
  const t = String(text);
  const p = [];
  if (/^[ \t]*evidence:/m.test(t)) p.push("an `evidence:` line");
  if (/lower bound/i.test(t)) p.push("a lower bound");
  if (/\blift\s+\d/i.test(t)) p.push("a lift");
  if (repo && new RegExp(`(^|[^A-Za-z0-9_.-])${String(repo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_-]|$)`, "i").test(t)) p.push("the repo name");
  const agents = t.match(/^[ \t]*agents:/gm)?.length ?? 0;
  if (agents) p.push(`${agents} \`agents:\` lines`);
  if (/Moves labels/.test(t)) p.push("a 'Moves labels' note");
  const rate = t.match(/[0-9]+% of [0-9]+/);
  if (rate) p.push(`a rate ${JSON.stringify(rate[0])}`);
  return p;
}

// Parse `drift census [--all-outliers]` text output.
export function parseCensus(text) {
  const lines = text.split("\n");
  const head = text.match(/^(\d+) conventions from (\d+) (?:units|symbols) in (\d+) roles/m);
  const header = head ? { conventions: +head[1], units: +head[2], roles: +head[3] } : null;
  const proposals = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\. \[(D-[0-9a-f]+)\] (.*)$/);
    if (m) {
      cur = { rank: +m[1], id: m[2], summary: m[3], split: null, example: null, outliers: [], more_outliers: 0, block: [line] };
      proposals.push(cur);
      continue;
    }
    if (!cur) continue;
    if (!line.trim()) {
      cur = null;
      continue;
    }
    let k;
    // The product's tier label is kept out of the block labellers see, so they label
    // blind to the tier (rule 5: the tier is recomputed from the pre-registered definition).
    if ((k = line.match(/^\s+tier:\s+(\w+)/))) {
      cur.census_tier = k[1];
      continue;
    }
    cur.block.push(line);
    if ((k = line.match(/^\s+evidence:\s+(\d+)\/(\d+) \(lower bound ([\d.]+), lift ([\d.]+)\)/)))
      cur.evidence = { holders: +k[1], total: +k[2], lower_bound: +k[3], lift: +k[4] };
    else if ((k = line.match(/^\s+split:\s+(.*)$/))) cur.split = k[1];
    else if ((k = line.match(/^\s+example:\s+(.*)$/))) cur.example = k[1].trim();
    // A path may hold spaces ("Academic Writing/x/main.py:12 main"): it runs to the first ":<line> ".
    else if ((k = line.match(/^\s+outlier:\s+(.+?):(\d+) (.*)$/))) cur.outliers.push({ path: k[1], line: +k[2], symbol: k[3] });
    else if ((k = line.match(/^\s+outlier:\s+(\S+) (.*)$/))) cur.outliers.push({ path: k[1], line: null, symbol: k[2] });
    else if ((k = line.match(/^\s+\.\.\. (\d+) more outliers/))) cur.more_outliers = +k[1];
  }
  for (const p of proposals) p.block = p.block.join("\n");
  return { header, proposals };
}

// Minimal YAML reader for the subset drift writes (.drift/conventions.yaml):
// block maps and sequences, plain/quoted scalars, comments. Not a general YAML parser.
export function parseYaml(text) {
  const lines = [];
  text.split("\n").forEach((raw, n) => {
    if (!raw.trim() || raw.trimStart().startsWith("#")) return;
    const indent = raw.length - raw.trimStart().length;
    lines.push({ indent, text: raw.trim(), no: n + 1 });
  });
  let i = 0;
  const isSeq = (t) => t === "-" || t.startsWith("- ");
  const keyRe = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^"'][^:]*?):(?:\s+(.*))?$/;

  function scalar(s) {
    s = s.trim();
    if (s.startsWith('"')) {
      try {
        return JSON.parse(s.replace(/\\\//g, "/"));
      } catch {
        throw new SafeParseError("yaml: invalid double-quoted scalar"); // never the text: it can name a held-out repo
      }
    }
    if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
    s = s.replace(/\s+#.*$/, "");
    if (s === "~" || s === "null") return null;
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "[]") return [];
    if (s === "{}") return {};
    if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return Number(s);
    if (s.startsWith("[") && s.endsWith("]"))
      return s
        .slice(1, -1)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map(scalar);
    return s;
  }
  function blockScalar(parentIndent, style) {
    const parts = [];
    while (i < lines.length && lines[i].indent > parentIndent) parts.push(lines[i++].text);
    return style.startsWith(">") ? parts.join(" ") : parts.join("\n");
  }
  function value(rest, indent) {
    if (rest === undefined || rest === "") {
      if (i < lines.length && (lines[i].indent > indent || (lines[i].indent === indent && isSeq(lines[i].text))))
        return block(lines[i].indent);
      return null;
    }
    if (/^[|>][-+]?$/.test(rest)) return blockScalar(indent, rest);
    return scalar(rest);
  }
  function block(indent) {
    return isSeq(lines[i].text) ? seq(indent) : map(indent);
  }
  function map(indent) {
    const out = {};
    while (i < lines.length && lines[i].indent === indent && !isSeq(lines[i].text)) {
      const m = lines[i].text.match(keyRe);
      if (!m) throw new SafeParseError(`yaml: cannot parse line ${lines[i].no}`);
      i++;
      const key = m[1].startsWith('"') || m[1].startsWith("'") ? scalar(m[1]) : m[1].trim();
      out[key] = value(m[2], indent);
    }
    return out;
  }
  function seq(indent) {
    const out = [];
    while (i < lines.length && lines[i].indent === indent && isSeq(lines[i].text)) {
      const content = lines[i].text === "-" ? "" : lines[i].text.slice(2).trim();
      if (!content) {
        i++;
        out.push(value("", indent));
      } else if (/^[|>][-+]?$/.test(content)) {
        i++;
        out.push(blockScalar(indent, content));
      } else if (isSeq(content)) {
        // "- - x": a nested sequence whose items sit at indent + 2
        lines[i] = { indent: indent + 2, text: content };
        out.push(seq(indent + 2));
      } else if (keyRe.test(content) && !content.startsWith('"') && !content.startsWith("'")) {
        // "- key: v" starts a map whose keys sit at indent + 2
        lines[i] = { indent: indent + 2, text: content };
        out.push(map(indent + 2));
      } else {
        i++;
        out.push(scalar(content));
      }
    }
    return out;
  }
  return lines.length ? block(lines[0].indent) : null;
}

// Rule families used in reports. Prefer structured data from conventions.yaml
// (rule.type, rule.kind, rule.signal); fall back to the rule text for runs without it.
export const FAMILIES = {
  wrapper: "Call wrappers",
  decorator: "Decorators",
  base_class: "Base classes",
  argument_key: "Argument keys",
  layering: "Layering (imports avoided)",
  renders: "Rendered components",
  jsx_wrapper: "Rendered inside a wrapper",
  calls: "Calls",
  naming: "Naming",
  avoids_other: "Other avoidance (any, console, bare Error)",
  ordering: "Call order",
  control: "Control and typing",
  repo: "Package and repo facts",
  import_source: "Import source",
  other: "Other",
};

// The `by_language[].language` row of a metrics.json for each tier language code.
export const LANGUAGE_ROWS = { ts: "typescript/javascript", py: "python" };

export function familyOf(p) {
  const r = p.rule;
  if (!r?.type) return familyFromText(p.summary) ?? "other";
  switch (r.type) {
    case "wrapped_by":
      return { call: "wrapper", decorator: "decorator", extends: "base_class", jsx: "jsx_wrapper" }[r.kind] ?? "wrapper";
    case "passes_key":
      return "argument_key";
    case "avoids":
      return String(r.signal).startsWith("import:") ? "layering" : "avoids_other";
    case "renders":
      return "renders";
    case "calls":
      return "calls";
    case "named":
      return "naming";
    case "before":
      return "ordering";
    case "control":
      return "control";
    case "dependency_version":
    case "package_has":
    case "prefers_library":
    case "model_has":
    case "has_test":
      return "repo";
    case "imports_from":
      return "import_source";
    default:
      return familyFromText(p.summary) ?? "other";
  }
}

// ---------- tiers ----------

// The structured rule kind of a proposal: conventions.yaml `rule.type`, refined by `rule.kind` for wrapped_by
// and by import vs other signals for avoids. Never derived from the summary text: a proposal without a
// structured rule has no kind (null), and a tier definition keyed on kinds puts it in the suggestion tier.
export const RULE_KINDS = [
  "wrapped_by:call",
  "wrapped_by:decorator",
  "wrapped_by:extends",
  "wrapped_by:jsx",
  "wrapped_by:try",
  // Python guard kinds (drift_core::WrapKind): suggestion tier, never mined as conventions today.
  "wrapped_by:config",
  "wrapped_by:authenticates",
  "wrapped_by:config_authenticates",
  "wrapped_by:opens",
  "wrapped_by:app_hook",
  "passes_key",
  "calls",
  "renders",
  "directive",
  "control",
  "throws",
  "named",
  "before",
  "avoids:import",
  "avoids:other",
  "has_test",
  "prefers_library",
  "model_has",
  "package_has",
  "dependency_version",
  // Wiring rules (experimental, `DRIFT_EXPERIMENTAL=wiring`): suggestion tier.
  "registered_in",
  "mirrors_keys",
  "imports_from",
  // A practice a person promoted from the practice map (`drift practices promote`): never mined, so no study
  // family and no admission by family; it is shown to agents because the person who promoted it chose so.
  "practice",
  // A package's files import only what its package.json declares (`from_map: manifest`): never mined, so no study
  // family either; proposed from the map and checked only once a person accepts it.
  "imports_declared",
];

// The one rule-family mapping (rounds 8 W0 + W4): apps/studio/src/entities/convention/rule-kind-family.json maps each
// rule kind to the family the Studio shows it under; drift_mine::rank reads the same file. The study's coarser
// family of a kind is `familyOf` of a rule of that kind (`ruleOfKind`).
export const RULE_KIND_FAMILY_FILE = "apps/studio/src/entities/convention/rule-kind-family.json";
// Read when first asked (a study harness without the Studio tree never needs it).
let ruleKindFamilyCache = null;
export const ruleKindFamily = () => (ruleKindFamilyCache ??= JSON.parse(readFileSync(join(repoRootDir, RULE_KIND_FAMILY_FILE), "utf8")));

// A rule of each kind, for `familyOf` (which reads `type`, `kind` and `signal`; never the summary here).
export function ruleOfKind(kind) {
  const [type, sub] = kind.split(":");
  if (type === "wrapped_by") return { type, kind: sub };
  if (type === "avoids") return { type, signal: sub === "import" ? "import:x" : "other" };
  return { type };
}

// The Studio's names for each study family, derived from rule-kind-family.json (never kept by hand): the keys of
// apps/studio/src/entities/convention/family-precision.json `latest.<language>.families`, written by
// apps/studio/scripts/make-study-fixtures.mjs, and of the family admission table (family-admission.mjs). One
// study family can be several Studio families (call wrappers, try bodies and guards are all `wrapper`); a kind
// whose study family is `other` has none. In FAMILIES order, names in RULE_KINDS order.
let studioFamiliesCache = null;
export const studioFamilies = () => (studioFamiliesCache ??= deriveStudioFamilies(ruleKindFamily()));
export function deriveStudioFamilies(kindToStudio) {
  const by = {};
  for (const k of RULE_KINDS) {
    const f = familyOf({ rule: ruleOfKind(k), summary: "" });
    const name = kindToStudio[k];
    if (f === "other" || !name) continue;
    const names = (by[f] ??= []);
    if (!names.includes(name)) names.push(name);
  }
  return Object.fromEntries(Object.keys(FAMILIES).filter((f) => by[f]).map((f) => [f, by[f]]));
}

export function ruleKind(rule) {
  if (!rule?.type) return null;
  if (rule.type === "wrapped_by") return `wrapped_by:${rule.kind ?? "?"}`;
  if (rule.type === "avoids") return String(rule.signal ?? "").startsWith("import:") ? "avoids:import" : "avoids:other";
  return rule.type;
}

// Whether a linked symbol id is not defined by the repository: a package's (`pkg:`), a built-in or ambient
// global (`global#`), or unresolved (`unresolved:`). Mirrors drift_mine::tier::outside_repo.
export const outsideRepo = (s) => /^(pkg:|global#|unresolved:)/.test(String(s ?? ""));

// Whether a rule names a symbol the repository does not define (outsideRepo): a package, built-in or
// unresolved wrapper, base class, callee, component or thrown class (any alternative of any_of), an
// `import:` avoidance of one, or the source or an alternative of an import-source rule (imports_from). A
// package object reached through a binding the repository defines (`models.py#ma.ModelSchema`) has an in-repo
// id and counts as in-repo. Mirrors drift_mine::tier::names_package.
export function namesPackage(rule) {
  const pkg = outsideRepo;
  switch (rule?.type) {
    case "wrapped_by":
      return (rule.any_of ?? []).some(pkg);
    case "passes_key":
    case "calls":
      return pkg(rule.callee);
    case "renders":
      return pkg(rule.component);
    case "throws":
      return pkg(rule.class);
    case "before":
      return pkg(rule.first) || pkg(rule.then);
    case "avoids":
      return String(rule.signal ?? "").startsWith("import:") && outsideRepo(String(rule.signal).slice("import:".length));
    case "imports_from":
      return pkg(rule.source) || (rule.instead_of ?? []).some(pkg);
    default:
      return false;
  }
}

// The language of a proposal, from its example (`path#symbol`, or a path): "py" for a `.py`/`.pyi` file or a
// Python package manifest (pyproject.toml, requirements*.txt, setup.cfg, Pipfile), "ts" (TypeScript/JavaScript)
// otherwise, a missing example included. Mirrors drift_mine::tier::language_of. Decision D7 keys the tier on it.
export const TIER_LANGUAGES = ["ts", "py"];
// The language the tier reads for a proposal (decision D7), conservatively, as drift_mine::tier::convention_language:
// "py" when any member of its role is Python (`python_members`, conventions.yaml evidence.python_members, which
// prepare.mjs copies into each queue item) or when its example is; "ts" otherwise. Runs prepared before
// python_members existed fall back to the example.
export const proposalLanguage = (p) => ((p?.python_members ?? 0) > 0 ? "py" : languageOf(p?.example));
// The language group metrics.mjs reports a proposal under: the convention's language, never its repo's.
export const LANGUAGE_GROUPS = { ts: "typescript/javascript", py: "python" };
export const proposalLanguageGroup = (p) => LANGUAGE_GROUPS[proposalLanguage(p)];
// The member count the tier reads: the role's size (conventions.yaml evidence.role_members when the rule is about
// only part of the role, else evidence.total), as drift_mine Evidence::role_size. D5 and D7 say "role has >= 15
// members"; members the rule is not about (exempt) still count.
export const tierMembers = (evidence) => evidence?.role_members ?? evidence?.total ?? null;

export function languageOf(example) {
  const path = String(example ?? "").split("#")[0];
  const name = path.slice(path.lastIndexOf("/") + 1);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const py = ext === "py" || ext === "pyi" || name === "pyproject.toml" || name === "setup.cfg" || name === "Pipfile" || (name.startsWith("requirements") && name.endsWith(".txt"));
  return py ? "py" : "ts";
}

// Pre-registered tier definitions (manifest `tier`, copied into run.json params.tier):
//   { kind: "min_members", value: N }   default tier = role has >= N members (the secondary sets before D5)
//   { kind: "rule_kind", default: { rule_kinds: [...], min_members: N, target?: "in_repo", languages?: [...] },
//     suggestion: { rule_kinds: [...], languages?: [...] } }
//       default tier = structured rule kind listed in default.rule_kinds AND role has >= N members AND, when
//       default.target is "in_repo" (decision D5, tier-d5.json), the rule names no symbol from outside the repository (namesPackage)
//       AND, when default.languages is given (decision D7, tier-d7.json), the proposal's language (languageOf its
//       example) is listed there; every other shown proposal is suggestion tier (unlisted kinds and languages, and
//       proposals without a structured rule, included). suggestion.rule_kinds and suggestion.languages document what
//       that tier holds; they do not add a third tier.
//       Rule 5 as pre-registered has no target; D5 is rule 5 with passes_key and renders moved to the
//       suggestion tier and target "in_repo"; D7 is D5 with only wrapped_by:call and avoids:import in the default
//       tier, for TypeScript/JavaScript only (default.languages ["ts"]; Python advises only, suggestion.languages ["py"]).
export function checkTier(t) {
  const p = [];
  if (!t || typeof t !== "object") return ["tier missing"];
  if (t.kind === "min_members") {
    if (!Number.isInteger(t.value)) p.push("min_members tier needs an integer value");
  } else if (t.kind === "rule_kind") {
    const d = t.default?.rule_kinds;
    const s = t.suggestion?.rule_kinds ?? [];
    if (!Array.isArray(d) || !d.length) p.push("rule_kind tier needs default.rule_kinds");
    if (!Number.isInteger(t.default?.min_members)) p.push("rule_kind tier needs default.min_members");
    for (const k of [...(d ?? []), ...s]) if (!RULE_KINDS.includes(k)) p.push(`unknown rule kind ${JSON.stringify(k)}`);
    for (const k of d ?? []) if (s.includes(k)) p.push(`rule kind ${k} is in both tiers`);
    if (t.default && "target" in t.default && t.default.target !== "in_repo") p.push(`unknown default.target ${JSON.stringify(t.default.target)}`);
    const dl = t.default?.languages;
    const sl = t.suggestion?.languages;
    if (dl !== undefined && (!Array.isArray(dl) || !dl.length)) p.push("default.languages must be a non-empty list");
    if (sl !== undefined && !Array.isArray(sl)) p.push("suggestion.languages must be a list");
    if (sl !== undefined && dl === undefined) p.push("suggestion.languages needs default.languages");
    for (const l of [...(Array.isArray(dl) ? dl : []), ...(Array.isArray(sl) ? sl : [])]) if (!TIER_LANGUAGES.includes(l)) p.push(`unknown language ${JSON.stringify(l)}`);
    for (const l of Array.isArray(dl) ? dl : []) if (Array.isArray(sl) && sl.includes(l)) p.push(`language ${l} is in both tiers`);
    // Per-language conditions of the default tier (the D8 candidate, tier-d8-candidate.json): a language of
    // default.languages may raise the member floor, and may admit a call wrapper only when every alternative is a guard.
    const bl = t.default?.by_language;
    if (bl !== undefined) {
      if (!bl || typeof bl !== "object" || Array.isArray(bl)) p.push("default.by_language must be an object");
      else
        for (const [l, o] of Object.entries(bl)) {
          if (l === "//") continue;
          if (!Array.isArray(dl) || !dl.includes(l)) p.push(`default.by_language.${l}: not a default.languages language`);
          for (const k of Object.keys(o ?? {})) if (!["//", "min_members", "call_wrappers"].includes(k)) p.push(`default.by_language.${l}: unknown key ${k}`);
          if (o?.min_members !== undefined && !(Number.isInteger(o.min_members) && o.min_members >= (t.default?.min_members ?? 0)))
            p.push(`default.by_language.${l}.min_members must be an integer no lower than default.min_members`);
          if (o?.call_wrappers !== undefined && o.call_wrappers !== "guards") p.push(`default.by_language.${l}.call_wrappers must be "guards"`);
        }
    }
  } else p.push(`unknown tier kind ${JSON.stringify(t.kind)}`);
  return p;
}

// "default" | "suggestion" for one queue item under a (checked) tier definition.
// A language's own conditions (default.by_language, the D8 candidate) raise its member floor and, with
// call_wrappers "guards", admit a call wrapper only when the product said every alternative is a guard: the item's
// `guards` (census --json --candidate d8 `candidate.guards`, drift_mine::security::authenticates on each
// alternative, copied in by stage.mjs --candidate-json). The study cannot read definitions, so anything but true
// (missing, null, false) is suggestion tier.
export function tierOf(p, t) {
  if (t.kind === "min_members") return (p.members ?? 0) >= t.value ? "default" : "suggestion";
  const lang = proposalLanguage(p);
  if (t.default.languages && !t.default.languages.includes(lang)) return "suggestion";
  const own = t.default.by_language?.[lang] ?? {};
  const k = ruleKind(p.rule);
  if (!k || !t.default.rule_kinds.includes(k) || (p.members ?? 0) < (own.min_members ?? t.default.min_members)) return "suggestion";
  if (own.call_wrappers === "guards" && k === "wrapped_by:call" && p.guards !== true) return "suggestion";
  return t.default.target === "in_repo" && namesPackage(p.rule) ? "suggestion" : "default";
}

// The tier block each registered held-out manifest must hold, by its `role`: decision D7's (tier-d7.json), which the
// product implements, for the primary sets (D7) and the secondary sets (D7a, the lead: D7 named the primaries only,
// and a secondary run must measure the tier the product ships, as D5a did for D5).
export const HELD_OUT_TIER_FILES = { primary: "tier-d7.json", secondary: "tier-d7.json" };
export const heldOutTierFile = (manifest) => HELD_OUT_TIER_FILES[manifest?.role] ?? null;

// The member threshold a tier applies (used to compare against --tier-min).
export const tierMinMembers = (t) => (t.kind === "min_members" ? t.value : t.default.min_members);

const LANGUAGE_NAMES = { ts: "TypeScript/JavaScript", py: "Python" };
export function describeTier(t) {
  if (t.kind === "min_members") return `role has ≥ ${t.value} members`;
  const target = t.default.target === "in_repo" ? ", the rule names no symbol from outside the repository (package, built-in, unresolved)" : "";
  const langs = t.default.languages ? `the proposal is ${t.default.languages.map((l) => LANGUAGE_NAMES[l] ?? l).join(" or ")}, ` : "";
  const advise = t.suggestion?.languages?.length ? ` (${t.suggestion.languages.map((l) => LANGUAGE_NAMES[l] ?? l).join(", ")}: advise only, every proposal suggestion tier)` : "";
  const own = Object.entries(t.default.by_language ?? {})
    .filter(([l]) => l !== "//")
    .map(([l, o]) => `${LANGUAGE_NAMES[l] ?? l}: ${[o.min_members !== undefined && `role has ≥ ${o.min_members} members`, o.call_wrappers === "guards" && "a call wrapper only when every alternative is a guard"].filter(Boolean).join(", ")}`);
  const ownText = own.length ? ` (${own.join("; ")})` : "";
  return `${langs}rule kind in {${t.default.rule_kinds.join(", ")}}${target} and role has ≥ ${t.default.min_members} members${ownText}; every other shown proposal is suggestion tier${advise}`;
}

export function familyFromText(s) {
  if (/ are decorated with /.test(s)) return "decorator";
  if (/ render inside </.test(s)) return "jsx_wrapper";
  if (/ extend /.test(s)) return "base_class";
  if (/ are wrapped in /.test(s)) return "wrapper";
  if (/ pass `[^`]+` to /.test(s)) return "argument_key";
  if (/ do not import from /.test(s)) return "layering";
  if (/ do not (use `|call console|throw)/.test(s)) return "avoids_other";
  if (/ render </.test(s)) return "renders";
  if (/ are named `/.test(s)) return "naming";
  if (/ call .+ before /.test(s)) return "ordering";
  if (/ take `[^`]+` from .+, not | use the team's `[^`]+` \(.+\), not /.test(s)) return "import_source";
  if (/ declare their return type| validate their input with a schema| use `(try|await)`/.test(s)) return "control";
  if (/^workspace packages |^\w+ models have | have a test file$| use \S+ for [\w-]+, not /.test(s)) return "repo";
  if (/ call /.test(s)) return "calls";
  return null;
}

// ---------- statistics ----------

// Wilson score interval for k successes out of n.
export function wilson(k, n, z = 1.959964) {
  if (!n) return { k, n, p: NaN, lo: NaN, hi: NaN };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { k, n, p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

// Cohen's kappa for paired categorical labels.
export function cohen(pairs, cats) {
  const n = pairs.length;
  if (!n) return { n, po: NaN, pe: NaN, kappa: NaN };
  const ca = Object.fromEntries(cats.map((c) => [c, 0]));
  const cb = Object.fromEntries(cats.map((c) => [c, 0]));
  let agree = 0;
  for (const [a, b] of pairs) {
    if (!(a in ca) || !(b in cb)) throw new Error(`cohen: label ${JSON.stringify(a in ca ? b : a)} is not one of ${cats.join("|")}`);
    ca[a]++;
    cb[b]++;
    if (a === b) agree++;
  }
  const po = agree / n;
  const pe = cats.reduce((s, c) => s + (ca[c] / n) * (cb[c] / n), 0);
  // pe = 1 (both labellers used one label only) leaves kappa undefined: NaN, dropped by bootstraps.
  return { n, po, pe, kappa: pe === 1 ? NaN : (po - pe) / (1 - pe) };
}

// Gwet's AC1 for two labellers (F2): (po - pe) / (1 - pe), pe = sum_q pi_q (1 - pi_q) / (Q - 1), pi_q the mean share of
// category q over both labellers. Unlike kappa, it does not collapse when one category dominates.
export function gwetAC1(pairs, cats) {
  const n = pairs.length;
  if (!n || cats.length < 2) return { n, po: NaN, pe: NaN, ac1: NaN };
  const share = Object.fromEntries(cats.map((c) => [c, 0]));
  let agree = 0;
  for (const [a, b] of pairs) {
    if (!(a in share) || !(b in share)) throw new Error(`gwetAC1: label ${JSON.stringify(a in share ? b : a)} is not one of ${cats.join("|")}`);
    share[a] += 1 / (2 * n);
    share[b] += 1 / (2 * n);
    if (a === b) agree++;
  }
  const po = agree / n;
  const pe = cats.reduce((s, c) => s + share[c] * (1 - share[c]), 0) / (cats.length - 1);
  return { n, po, pe, ac1: pe === 1 ? NaN : (po - pe) / (1 - pe) };
}
// F2: below this many paired labels only raw agreement is printed; at or above it, kappa and AC1 with intervals.
export const MIN_N_CHANCE_CORRECTED = 30;

// Deterministic PRNG (mulberry32) seeded from a string.
export function rng(seedText) {
  let h = 2166136261;
  for (const ch of String(seedText)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A hashed pool entry: lets a selection exclude the repos of a pool committed only as hashes (eval/<pool>-hashes.json,
// e.g. apps11's blind half) without anyone reading their names. kind is "slug" (owner/repo) or "name" (the repo
// name); the value is lower-cased.
export const poolHash = (kind, value) => createHash("sha256").update(`${kind}:${String(value).toLowerCase()}`).digest("hex");

export function shuffle(arr, seedText) {
  const r = rng(seedText);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The order a prompt shows one repo's proposals or cases in. Census rank is in tier order (the
// default tier first), so no stage may render in rank order: every stage shuffles, seeded by run,
// labeller, repo and (for match) which list. The label seed is the one used since the first run.
export function promptOrder(items, { run, labeller, repo, list = null }) {
  return shuffle(items, list ? `${run}:${labeller}:${repo}:${list}` : `${run}:${labeller}:${repo}`);
}

// Percentile bootstrap over clusters (repos): resample clusters with replacement and
// recompute a ratio sum(k)/sum(n). Proposals within a repo are not independent, so a cluster
// interval is the honest one for pooled rates; Wilson is reported alongside.
// With 15-20 clusters, several of them tiny, a percentile bootstrap tends to under-cover, so callers
// also report clusterT() as a cross-check and print the number of clusters.
// Every pooled rate uses the same default seed: the intervals are deterministic, and not independent draws.
export function clusterBootstrap(clusters, { iters = 4000, seed = "drift-study" } = {}) {
  const cs = clusters.filter((c) => c.n > 0);
  if (cs.length < 2) return { lo: NaN, hi: NaN, clusters: cs.length };
  const r = rng(seed);
  const stats = [];
  for (let it = 0; it < iters; it++) {
    let k = 0;
    let n = 0;
    for (let j = 0; j < cs.length; j++) {
      const c = cs[Math.floor(r() * cs.length)];
      k += c.k;
      n += c.n;
    }
    stats.push(k / n);
  }
  stats.sort((a, b) => a - b);
  return { lo: stats[Math.floor(0.025 * iters)], hi: stats[Math.ceil(0.975 * iters) - 1], clusters: cs.length };
}

// Cluster-robust (linearised ratio) interval with a t(G-1) critical value:
// p = sum(k)/sum(n), Var = G/(G-1) * sum((k_g - p n_g)^2) / sum(n)^2.
export function clusterT(clusters) {
  const cs = clusters.filter((c) => c.n > 0);
  const G = cs.length;
  if (G < 2) return { lo: NaN, hi: NaN, clusters: G };
  const K = cs.reduce((s, c) => s + c.k, 0);
  const N = cs.reduce((s, c) => s + c.n, 0);
  const p = K / N;
  const v = (G / (G - 1)) * cs.reduce((s, c) => s + (c.k - p * c.n) ** 2, 0) / (N * N);
  const h = tCrit(G - 1) * Math.sqrt(v);
  return { lo: Math.max(0, p - h), hi: Math.min(1, p + h), clusters: G };
}

// Two-sided 95% critical value of Student's t.
export function tCrit(df) {
  const t = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
  if (df < t.length) return t[df];
  return df < 60 ? 2.0 + (2.042 - 2.0) * (60 - df) / 30 : 1.96 + 0.04 * (60 / df);
}

// F3: the interval to quote for a rate pooled over units within repos: the widest of Wilson, the repo-cluster
// bootstrap and the cluster-t interval (a missing cluster interval is skipped). { lo, hi, source }.
export function widestInterval(w, boot, t) {
  const cands = [
    ["wilson", w],
    ["bootstrap", boot],
    ["cluster-t", t],
  ].filter(([, x]) => x && Number.isFinite(x.lo) && Number.isFinite(x.hi));
  if (!cands.length) return { lo: NaN, hi: NaN, source: null };
  const [source, x] = cands.reduce((a, b) => (b[1].hi - b[1].lo > a[1].hi - a[1].lo ? b : a));
  return { lo: x.lo, hi: x.hi, source };
}
// D1 (and D4) verdicts. Under F3 (runs prepared with params.decisions including "F3"): n >= D1_MIN_N and the quoted
// (widest) lower bound >= TARGET. Without it, the 2026-11-05 rule: the point estimate >= TARGET. null when n = 0.
export const D1_MIN_N = 30;
export function d1Met(rate, { f3 = false, target = 0.95 } = {}) {
  if (!rate || !Number.isFinite(rate.p)) return null;
  if (!f3) return rate.p >= target;
  return rate.n >= D1_MIN_N && Number.isFinite(rate.quoted?.lo) && rate.quoted.lo >= target;
}
// Condition (c) under F3: one-sided. The blind result is not more than `points` BELOW the in-sample one; a blind result
// above in-sample passes.
export function conditionC(blind, inSample, points = 0.1) {
  return Number.isFinite(blind) && Number.isFinite(inSample) && blind >= inSample - points - 1e-9;
}

// ---------- formatting ----------

export const pct = (x, d = 0) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "–");
export const ci = (w, d = 0) => (Number.isFinite(w.p) ? `${pct(w.p, d)} [${pct(w.lo, d)}–${pct(w.hi, d)}]` : "–");

export function table(header, rows) {
  const out = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const r of rows) out.push(`| ${r.join(" | ")} |`);
  return out.join("\n");
}

// ---------- decisions recorded before any held-out census (README.md, decision log 2026-11-05) ----------

// D1: the default-tier accept target is met when its POINT ESTIMATE, per language, over all shown with
// unlabelled counted as WRONG, is >= TARGET. The Wilson and cluster intervals are always published next to it;
// pooled TypeScript/JavaScript + Python figures are secondary only.
export const TARGET = 0.95;
export const TARGET_CRITERION = "met when the point estimate, per language, is ≥ 95% (decision D1, 2026-11-05)";
// D4 (product lead): the not-wrong target (over all shown, both tiers, unlabelled = WRONG) is judged the same way.
export const NOT_WRONG_CRITERION = "met when the point estimate, per language, is ≥ 95% (decision D4, 2026-11-05)";
// D2: primaries that look like course material by name. They stay in, as pre-registered (rule 1 replaces only on
// a technical failure); per-language results are also reported without them, as a sensitivity check.
// ---------- rubrics ----------

const studyDir = dirname(fileURLToPath(import.meta.url));
// practices: the text pre-registered first (PREREG-R13-practices.md, d8b24faa), never used for a label; practices2:
// its replacement under amendment 1 (neutral attributes, for the M-apart controls). Their labeller-facing texts say
// no version: the leak check refuses "v1".
// practice-describe and practice-match: the two steps of F6 (PLAN-R14 WS-F), which replaced both before any label.
export const RUBRICS = { v2: "RUBRIC-v2.md", v3: "RUBRIC-v3.md", v4: "RUBRIC-v4.md", practices: "RUBRIC-practices-v1.md", practices2: "RUBRIC-practices-v2.md", "practice-describe": "RUBRIC-practice-describe-v1.md", "practice-match": "RUBRIC-practice-match-v1.md", "practice-recall-list": "RUBRIC-practice-recall-list-v1.md", "practice-recall-match": "RUBRIC-practice-recall-match-v1.md" };
export const PRACTICE_RUBRICS = { describe: "practice-describe", match: "practice-match", "recall-list": "practice-recall-list", "recall-match": "practice-recall-match" };
// The labeller-facing practice texts pre-registered in PREREG-R13-practices.md (the F6 rewrite): prompt.mjs renders no
// practice prompt with another text. A change needs a new id, file and recorded amendment.
export const APPROVED_PRACTICE_RUBRICS = {
  "practice-describe": { file: "RUBRIC-practice-describe-v1.md", sha256: "ed57ad294f3c3d06f78d5bfb896efa2add9717c6e7710784dbe77c16562d0c0c" },
  "practice-match": { file: "RUBRIC-practice-match-v1.md", sha256: "a4254b69186535cfa0f9dd1c30a5768c05ba7e8fafff3aad44adcbab721f3503" },
  "practice-recall-list": { file: "RUBRIC-practice-recall-list-v1.md", sha256: "f122762ec91b169659d56e474ad664a8a2e6b18fcd33d04980d41c43665c2b4d" },
  "practice-recall-match": { file: "RUBRIC-practice-recall-match-v1.md", sha256: "b6028fa20156c9988f2048ff98f4abd835d018eef4f6f73e4f9c6e3d43cde0b8" },
  prereg: "PREREG-R13-practices.md",
};
// The rubric text labellers and adjudicators see: the title and everything from "## The setting" on (no study
// history), without the <!-- study-only --> blocks (the "Moves labels" notes say which way a rule moves earlier
// labels). Refuses a v3 text that still refers to earlier rubrics or to label shifts.
export function rubricText(version, dir = studyDir) {
  if (!RUBRICS[version]) die(`rubric must be one of ${Object.keys(RUBRICS).join(", ")}`);
  const t = readFileSync(join(dir, RUBRICS[version]), "utf8");
  const title = t.split("\n")[0];
  const at = t.search(/^## The setting$/m);
  if (at < 0) die(`${RUBRICS[version]}: no "## The setting" heading, so there is no labeller-facing text to render`);
  const body = t.slice(at).replace(/<!-- study-only -->[\s\S]*?<!-- \/study-only -->\n*/g, "");
  const text = `${title}\n\n${body}`.trim().replace(/^#/gm, "###").replace(/\n{3,}/g, "\n\n");
  const leak = text.match(/Moves labels|study-only|\bv[12]\b|earlier labels|previous label/);
  if (version !== "v2" && leak) die(`${RUBRICS[version]}: the labeller-facing text contains ${JSON.stringify(leak[0])}`);
  const leaks = version.startsWith("practice") || version === "v4" ? promptLeaks(text) : [];
  if (leaks.length) die(`${RUBRICS[version]}: the labeller-facing text contains ${leaks.join(", ")}`);
  return text;
}
export const sha256Text = (text) => createHash("sha256").update(text).digest("hex");
// The rubric texts (sha256) named by a run's collected label and adjudication records (collect.mjs stamps each
// record with its prompt's text hash), so a cleared or edited prompts/index.json cannot hide what labels saw.
export function recordRubricShas(runDir) {
  const out = new Set();
  for (const L of ["A", "B", "C"]) for (const r of readJsonlAll(join(runDir, "labels", L))) if (r.rubric_sha256) out.add(r.rubric_sha256);
  return [...out];
}
// The labeller-facing v3 text approved with decision D6 (the text the calibration was labelled with). A held-out
// run must use exactly this text: changing the rubric after approval needs a new recorded decision.
export const APPROVED_RUBRIC = { version: "v3", sha256: "79316bdc08a60209a5fb4cb887ad35a4ca4131255e96da2909c2242ac4e2c1dd", decision: "D6" };

// The study's decision log (README.md, "Decisions before any held-out census"), as metrics.json carries it.
export const DECISIONS = [
  { id: "D1", date: "2026-11-05", by: "founder", status: "decided", title: "default-tier accept target met when the point estimate, per language, is >= 95%" },
  { id: "D2", date: "2026-11-05", by: "founder", status: "decided", title: "course-material repos stay in; results also shown without them" },
  { id: "D3", date: "2026-11-05", by: "product lead", status: "decided", title: "parseable files = scan files - parse errors; census or init failures reported, no swap" },
  { id: "D4", date: "2026-11-05", by: "product lead", status: "decided", title: "not-wrong target met when the point estimate, per language, is >= 95%" },
  { id: "D5", date: "2026-11-06", by: "lead; approved by founder 2026-11-06", status: "approved", title: "the default tier admits only in-repo structural rules (tier-d5.json), approved before any held-out census" },
  { id: "D5a", date: "2026-11-06", by: "lead", status: "decided", title: "secondary sets measured under the D5 tier: a tier-only amendment applying D5 to the secondary manifests" },
  { id: "D6", date: "2026-11-06", by: "lead; approved by founder 2026-11-06", status: "approved", title: "rubric v3 (RUBRIC-v3.md) for the held-out run and later dev rounds; the default tier ships as advise until it measures >= 95% under v3", rubric_sha256: "79316bdc08a60209a5fb4cb887ad35a4ca4131255e96da2909c2242ac4e2c1dd" },
  { id: "D7", date: "2026-11-06", by: "founder (approved)", status: "approved", title: "default tier is TypeScript/JavaScript call wrappers and layering only (tier-d7.json, D5's target and member conditions kept); Python advises only; release gate unchanged; recorded before any held-out census" },
  { id: "D7a", date: "2026-11-06", by: "lead", status: "decided", title: "secondary sets measured under the D7 tier: a tier-only amendment applying D7 to the secondary manifests, before any held-out census" },
  { id: "D8", date: "2026-11-07", by: "lead (pre-registration; not approved)", status: "pre-registered", title: "candidate Python default tier (tier-d8-candidate.json: guard call wrappers and layering, in-repo, roles >= 50), with dev (>= 40 cards, >= 10 repos, >= 97.5%) and held-out (>= 30 cards, >= 95%) thresholds; NOT adopted: the product ships D7 and Python advises only" },
  { id: "D9", date: "2026-11-07", by: "lead", status: "decided", title: "reserve exhaustion at runbook step 4, decided before any held-out census, blind to outcomes: F is the product tree at 29f4cd6 (changes under eval/ do not move it); unfilled slots take further reserves drawn by select-holdout.mjs's own procedure (same pool, filters, seed and walk order, reserve_order continued cyclically), checked by the same rule 1 in order; if the pool runs out, the run goes ahead with the slots filled" },
  { id: "D11", date: "2026-11-07", by: "lead", status: "decided", title: "second held-out draw (select-holdout.mjs --selection heldout2: 18 TS/JS and 10 Python repos, 18 and 12 reserves, the primary draw's buckets and rules, a new seed committed before the draw, every dev and earlier held-out repo excluded): selection only; census at the round-9 freeze; used for the D1/D4 re-measure and the D10.3 verifier check; these sets cannot take amendments (every amendment must precede every held-out run record, and the primary run's exist), so the reserves were over-drawn and the D7 tier is final; frozen 2026-11-08 on the product tree of de57356 (outside eval/: 2018b7c84ac7); no verifier check (D10.3 dev gate not met, 84.3% < 90%); recall not measured" },
  { id: "WS-F", date: "2026-11-09", by: "lead (PLAN-R14 WS-F; D-3 and D-4 at their defaults)", status: "decided", title: "F1: rubric v4, cards without evidence numbers, masked repo, extended leak check, v4 never pooled with earlier labels; F2: raw agreement below n = 30, kappa and AC1 with intervals at n >= 30, no adjectives; F3: the widest of Wilson, bootstrap and cluster-t quoted, D1/D4 at n >= 30 on the quoted lower bound for runs prepared under F3 (params.decisions), condition (c) one-sided; F4: A, B, C on three models with model ids committed, rates also with adjudicated items as WRONG; F5: the human-anchor form and report, nothing labelled; F6: practice labels from a description blind to the assignment, then a match. Past sets are not re-read." },
];
export const COURSE_MATERIAL = {
  "ts-primary-2026-11-05": ["computer-science-fundamentals"],
  "py-primary-2026-11-05": ["cs146s_cn"],
};

// ---------- held-out manifests ----------

// The frozen core of a held-out manifest: what may never change once a version with `frozen_at` exists in
// the manifest's history. `replaced`, `burned` and `exposed` are append-only lists outside it.
// `set_id` names the set across renames; `role` ("primary" | "secondary") cannot be flipped without changing it.
export const CORE_SCHEME = "core-v2";
export const CORE_FIELDS = ["set_id", "role", "frozen_at", "repos", "reserves", "tier", "max", "pool"];
const canon = (v) =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).filter((k) => k !== "//").sort().map((k) => [k, canon(v[k])])) : v;
export const coreSha = (m) => createHash("sha256").update(JSON.stringify(canon(Object.fromEntries(CORE_FIELDS.map((f) => [f, m[f] ?? null]))))).digest("hex");

// Whether a frozen version `v` of a registered manifest, whose core differs from the registered `core`, was
// superseded by a registered amendment (holdout-manifests.json `amendments`, decision D5): an entry for `path`
// names coreSha(v) as superseded and `core` as produced, amends the tier only, and `v` with the current
// manifest's tier has exactly the registered core (so nothing but the tier changed).
//
// No chaining: an entry allows a version only when it produced the CURRENT core. A second amendment of the
// same manifest (core B -> C, after A -> B) must therefore add an entry from EVERY earlier frozen core to the
// new one (A -> C and B -> C), each amending the tier only; the A -> B entry stays (amendments are append-only,
// heldOutHistoryProblems) but no longer allows anything. This keeps the check one step from any frozen
// version to the core that is measured, with no path through intermediate cores to audit.
//
// Decision D9 (2026-11-07) adds one more amendable field: `reserves`, append only. An entry with fields
// ["reserves"] or ["tier", "reserves"] allows `v` when `v`'s reserve list is a strict prefix of the current one
// (nothing removed, reordered or re-pinned) and `v` with the current tier (if amended) and the current reserve
// list has exactly the registered core. Every other core field (set_id, role, frozen_at, repos, max, pool) is
// never amendable.
export const AMENDABLE_FIELDS = [["tier"], ["reserves"], ["tier", "reserves"]];
export const amendableFields = (fields) => AMENDABLE_FIELDS.some((f) => JSON.stringify(f) === JSON.stringify(fields));
// Whether `after`'s reserves only append to `before`'s: a strict prefix, compared canonically.
export function reservesAppended(before, after) {
  const b = before?.reserves?.repos ?? [];
  const a = after?.reserves?.repos ?? [];
  return a.length > b.length && b.every((r, i) => JSON.stringify(canon(r)) === JSON.stringify(canon(a[i])));
}
export function amendmentAllows(registryFile, path, v, current, core) {
  return (registryFile.amendments ?? []).some((a) => {
    if (a.path !== path || a.superseded_core !== coreSha(v) || a.core !== core || !amendableFields(a.fields)) return false;
    const next = { ...v };
    if (a.fields.includes("tier")) next.tier = current.tier;
    if (a.fields.includes("reserves")) {
      if (!reservesAppended(v, current)) return false;
      next.reserves = { ...(v.reserves ?? {}), repos: current.reserves.repos };
    }
    return coreSha(next) === core;
  });
}

// A held-out run record under eval/study/runs (any depth): a start record (`start.json`, held_out: true),
// which prepare.mjs writes and requires to be committed before a held-out census; or a `run.json` of a
// held-out manifest with at least one repo row, i.e. a census ran. The `--only none` preflight (runbook step 3)
// clones and scans nothing and runs no census: its run.json has no repo rows and is not a census record.
export const isHeldOutRecord = (file, j) =>
  /(^|\/)start\.json$/.test(file) ? j?.held_out === true : j?.manifest?.holdout === true && Array.isArray(j.repos) && j.repos.length > 0;

// The amendments with their registered corrections applied, in order. A correction is how an amendment entry
// is changed without rewriting it (amendments are append-only): `corrections` entries name one amendment by
// [path, superseded_core, core] and change one descriptive field (decision, by or note) from one value to
// another. A correction never changes what an amendment allows (path and cores are not correctable).
export const CORRECTABLE = ["decision", "by", "note"];
const amendmentKey = (a) => JSON.stringify([a.path, a.superseded_core, a.core]);
export function effectiveAmendments(registryFile) {
  const out = (registryFile.amendments ?? []).map((a) => ({ ...a }));
  for (const c of registryFile.corrections ?? []) {
    const a = out.find((x) => amendmentKey(x) === JSON.stringify(c.amendment ?? null));
    if (a && CORRECTABLE.includes(c.field) && a[c.field] === c.from) a[c.field] = c.to;
  }
  return out;
}

// The held-out record's committed history, checked the same way by prepare.mjs (a held-out run) and
// select-holdout.mjs verify. `src` is the repository root, `registryFile` the registry as read (verify may be
// given another copy), `registryRel` its repo-relative path. Reads git objects and the working tree only.
// Returns a list of problems (empty: the history is consistent):
//   - every version of a held-out manifest file ever committed with frozen_at still exists among the
//     registered manifests (same set_id) with the same core, or a registered amendment allows it;
//   - amendments and corrections are append-only (compared canonically, so key order does not matter): every
//     entry any committed registry version on HEAD held is still in the registry;
//   - no amendment entry is listed twice; each names a registered manifest and its set_id, an ISO date, and
//     cores of frozen versions of that set (no entry for a version that was never frozen); each correction
//     names one amendment, a correctable field and its current value, and an ISO date;
//   - ORDER BY HISTORY, NOT DATES: every amendment is in the history of every held-out run record. For each
//     commit on ANY ref (git log --all) whose tree holds a held-out run record (isHeldOutRecord, at any depth
//     under eval/study/runs), some registry commit holding the amendment must be an ancestor of it (or it, as
//     git merge-base --is-ancestor counts; computed from one `git rev-list --parents` walk). Every walk runs without history simplification (--full-history -m) and reads
//     raw paths (-z), so merges (a record added by a merge, an -s ours merge, a branch that later deleted its
//     run directory, a merge that takes one side's registry) and names git would quote cannot hide anything. So an amendment committed after a held-out run started, beside it on another
//     branch, or not committed at all, is refused, whatever its date or committer date says;
//   - a census record in the working tree has a committed start record (prepare.mjs refuses a census otherwise);
//   - every run record parses.
// What this cannot do: it reads this clone. Someone who rewrites local history, or deletes an uncommitted run
// directory, can defeat any local check. It prevents accidents and honest-operator mistakes; the pushed
// history and the PR record are the audit trail.
export function heldOutHistoryProblems(src, registryFile, registryRel, { runsRel = join(dirname(registryRel), "runs") } = {}) {
  const git = (...a) => execFileSync("git", ["-C", src, ...a], { encoding: "utf8", maxBuffer: 1 << 28 }).trim();
  const showRaw = (c, f) => {
    try {
      return { ok: true, text: execFileSync("git", ["-C", src, "show", `${c}:${f}`], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }) };
    } catch {
      return { ok: false }; // not in that commit
    }
  };
  const parse = (t) => {
    try {
      return JSON.parse(t);
    } catch {
      return undefined;
    }
  };
  const show = (c, f) => {
    const r = showRaw(c, f);
    return r.ok ? (parse(r.text) ?? null) : null; // deleted in that commit, or not JSON
  };
  const canonical = (v) => JSON.stringify(canon(v));
  // Commits that touch `specs`, without history simplification: --full-history walks every parent of a merge
  // (an `-s ours` merge, a merge that takes one side's file), and -m lists a merge that adds or changes a
  // path against any of its parents. Deduplicated (-m can list a merge once per parent).
  const touching = (specs, { all = false, reverse = false } = {}) => [
    ...new Set(git("log", ...(all ? ["--all"] : []), ...(reverse ? ["--reverse"] : []), "--full-history", "-m", "--format=%H", "--", ...specs).split("\n").filter(Boolean)),
  ];
  // A commit's tree under `prefix` (or the whole tree), NUL-separated (-z), so paths are raw, never quoted:
  // [{ mode, type, oid, path }].
  const tree = (c, prefix) =>
    execFileSync("git", ["-C", src, "ls-tree", "-r", "-z", c, ...(prefix ? ["--", prefix] : [])], { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\0")
      .filter(Boolean)
      .map((e) => {
        const tab = e.indexOf("\t");
        const [mode, type, oid] = e.slice(0, tab).split(" ");
        return { mode, type, oid, path: e.slice(tab + 1) };
      });
  const blob = (oid) => {
    try {
      return { ok: true, text: execFileSync("git", ["-C", src, "cat-file", "blob", oid], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }) };
    } catch {
      return { ok: false };
    }
  };
  const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
  const problems = [];
  if (git("rev-parse", "--is-shallow-repository") === "true") return ["the clone is shallow; the held-out manifests' history cannot be checked"];
  const registry = registryFile.manifests ?? {};
  const manifests = Object.fromEntries(Object.keys(registry).map((p) => [p, existsSync(join(src, p)) ? (parse(readFileSync(join(src, p), "utf8")) ?? null) : null]));
  for (const [p, m] of Object.entries(manifests)) if (!m) problems.push(`${p}: registered, but missing or not JSON`);
  const current = new Map(Object.entries(manifests).filter(([, m]) => m).map(([p, m]) => [m.set_id, { path: p, core: registry[p], manifest: m }]));

  // Every committed registry version reachable from HEAD (full history: through every parent of a merge, so a
  // merge that takes another branch's registry cannot hide a version), oldest first.
  const regVersions = touching([registryRel], { reverse: true })
    .map((c) => ({ commit: c, file: show(c, registryRel) }))
    .filter((r) => r.file);
  const paths = new Set(Object.keys(registry));
  for (const r of regVersions) for (const k of Object.keys(r.file.manifests ?? {})) paths.add(k);

  // Every frozen version of every held-out manifest file ever committed reachable from HEAD (full history): the
  // paths registered in any registry version, and any eval/**/holdout*.json, so a renamed manifest is still
  // found by its new or old path (git log is not run with --follow). Read from each touching commit's tree
  // (raw paths, -z), deduplicated by blob, plus the registered manifests as they are now.
  const frozen = []; // { where, set_id, core, v }
  const seenBlobs = new Set();
  const isManifestPath = (f) => paths.has(f) || /(^|\/)holdout[^/]*\.json$/.test(f);
  for (const c of touching([...paths, ":(glob)**/holdout*.json"])) {
    for (const e of tree(c)) {
      if (!isManifestPath(e.path) || e.type !== "blob" || seenBlobs.has(e.oid)) continue;
      seenBlobs.add(e.oid);
      const r = blob(e.oid);
      const v = r.ok ? parse(r.text) : undefined;
      if (!v?.frozen_at || !v.set_id) continue; // not a frozen version (before freezing), or not a manifest
      frozen.push({ where: `${e.path} at ${c.slice(0, 12)}`, set_id: v.set_id, core: coreSha(v), v });
    }
  }
  for (const [p, m] of Object.entries(manifests)) if (m?.frozen_at && m.set_id) frozen.push({ where: `${p} (working tree)`, set_id: m.set_id, core: coreSha(m), v: m });
  for (const f of frozen) {
    const now = current.get(f.set_id);
    if (!now) problems.push(`${f.where} froze set ${f.set_id}, which is no longer a registered manifest (renamed or replaced after freezing)`);
    else if (f.core !== now.core && !amendmentAllows(registryFile, now.path, f.v, now.manifest, now.core))
      problems.push(`${f.where} froze set ${f.set_id} with another core, and no registered amendment allows it: it was changed after freezing`);
  }

  // The amendments and their corrections.
  const amendments = registryFile.amendments ?? [];
  const corrections = registryFile.corrections ?? [];
  const counts = new Map();
  for (const a of amendments) counts.set(amendmentKey(a), (counts.get(amendmentKey(a)) ?? 0) + 1);
  for (const [k, n] of counts) if (n > 1) problems.push(`amendments: ${k} is listed ${n} times`);
  for (const [list, now] of [["amendments", amendments], ["corrections", corrections]]) {
    const have = new Set(now.map(canonical));
    const reported = new Set();
    for (const r of regVersions)
      for (const old of r.file[list] ?? [])
        if (!have.has(canonical(old)) && !reported.has(canonical(old))) {
          reported.add(canonical(old));
          problems.push(`${list}: the entry ${list === "amendments" ? amendmentKey(old) : canonical(old)} committed in ${r.commit.slice(0, 12)} was removed or changed (${list} are append-only)`);
        }
  }
  amendments.forEach((a, i) => {
    if (!isDate(a.date)) problems.push(`amendments[${i}]: date ${JSON.stringify(a.date)} is not an ISO date (YYYY-MM-DD)`);
    const m = manifests[a.path];
    if (!m) return problems.push(`amendments[${i}]: ${a.path} is not a registered manifest`);
    if (a.set_id !== m.set_id) problems.push(`amendments[${i}]: set_id ${a.set_id}, ${a.path} is set ${m.set_id}`);
    const cores = new Set(frozen.filter((f) => f.set_id === m.set_id).map((f) => f.core));
    if (!cores.has(a.superseded_core)) problems.push(`amendments[${i}]: superseded_core ${String(a.superseded_core).slice(0, 12)} is not the core of any frozen version of ${m.set_id}`);
    if (!cores.has(a.core)) problems.push(`amendments[${i}]: core ${String(a.core).slice(0, 12)} is not the core of any frozen version of ${m.set_id}`);
  });
  {
    const eff = amendments.map((a) => ({ ...a }));
    corrections.forEach((c, i) => {
      const targets = eff.filter((x) => amendmentKey(x) === JSON.stringify(c.amendment ?? null));
      if (targets.length !== 1) return problems.push(`corrections[${i}]: names ${JSON.stringify(c.amendment)}, which is not exactly one amendment`);
      if (!CORRECTABLE.includes(c.field)) return problems.push(`corrections[${i}]: field ${JSON.stringify(c.field)} cannot be corrected (only ${CORRECTABLE.join(", ")})`);
      if (targets[0][c.field] !== c.from) problems.push(`corrections[${i}]: from ${JSON.stringify(c.from)}, but the amendment's ${c.field} is ${JSON.stringify(targets[0][c.field])}`);
      if (typeof c.to !== "string" || !c.to || c.to === c.from) problems.push(`corrections[${i}]: to must be a new, non-empty value`);
      if (!isDate(c.date) || !c.by || !c.reason) problems.push(`corrections[${i}] needs an ISO date, by and reason`);
      targets[0][c.field] = c.to;
    });
  }

  // Held-out run records: committed on any ref, and in the working tree. Commits are found without history
  // simplification (touching, --all), and each one's tree is read under eval/study/runs, so a record added in a
  // merge, on a branch merged with -s ours and deleted, or on a branch that later removed its run directory,
  // is still seen. A record-named entry that is not a readable file, or not JSON, is a problem, never skipped.
  const runCommits = []; // { commit, where }
  const isRecordPath = (f) => /(^|\/)(run|start)\.json$/.test(f);
  const blobState = new Map(); // oid -> held-out? (undefined: not JSON)
  for (const c of touching([runsRel], { all: true })) {
    for (const e of tree(c, runsRel)) {
      if (!isRecordPath(e.path)) continue;
      if (e.type !== "blob" || e.mode === "120000") {
        problems.push(`${e.path} at ${c.slice(0, 12)}: a run record that is not a regular file (${e.type} ${e.mode})`);
        continue;
      }
      if (!blobState.has(e.oid)) {
        const r = blob(e.oid);
        const j = r.ok ? parse(r.text) : undefined;
        blobState.set(e.oid, j === undefined ? undefined : isHeldOutRecord(e.path, j));
      }
      const held = blobState.get(e.oid);
      if (held === undefined) problems.push(`${e.path} at ${c.slice(0, 12)}: a run record that cannot be read as JSON`);
      else if (held) runCommits.push({ commit: c, where: `${e.path} at ${c.slice(0, 12)}` });
    }
  }
  const walkTree = (dir) => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((d) => isRecordPath(d.name))
      .map((d) => ({ rel: relative(src, join(d.parentPath ?? d.path, d.name)).split("\\").join("/"), file: d.isFile() }));
  };
  for (const { rel, file } of walkTree(join(src, runsRel))) {
    if (!file) {
      problems.push(`${rel}: a run record that is not a regular file`);
      continue;
    }
    const j = parse(readFileSync(join(src, rel), "utf8"));
    if (j === undefined) {
      problems.push(`${rel}: a run record that is not JSON`);
      continue;
    }
    if (/(^|\/)start\.json$/.test(rel)) {
      if (j === null || typeof j !== "object") problems.push(`${rel}: a start record that is not an object`);
      continue;
    }
    if (isHeldOutRecord(rel, j) && !showRaw("HEAD", rel.replace(/run\.json$/, "start.json")).ok)
      problems.push(`${rel}: a held-out census record whose run has no committed start record (${rel.replace(/run\.json$/, "start.json")})`);
  }
  if (runCommits.length) {
    const holding = new Map(); // amendment key -> registry commits (any ref) whose registry holds it
    const regAll = touching([registryRel], { all: true });
    for (const c of regAll) for (const a of show(c, registryRel)?.amendments ?? []) {
      const k = canonical(a);
      if (!holding.has(k)) holding.set(k, []);
      holding.get(k).push(c);
    }
    // Ancestry from one walk instead of one `git merge-base --is-ancestor x r` per (amendment, registry commit,
    // run record): that grew with amendments x registry commits x run commits (13k processes, a minute per call,
    // at 217 run commits). `git rev-list --parents` of the run commits lists every ancestor of every run commit
    // with its parents (full history, every parent of a merge), which holds every path from a registry commit
    // to a run commit. `x` is an ancestor of `r` (or `r` itself, as --is-ancestor counts it) iff `r` is reached
    // from `x` along child edges. Per distinct set of holding commits: the commits descending from any of them.
    const children = new Map(); // commit -> child commits, within the run commits' ancestry
    const inGraph = new Set();
    const runTips = [...new Set(runCommits.map((r) => r.commit))];
    const revList = execFileSync("git", ["-C", src, "rev-list", "--parents", "--stdin"], { input: `${runTips.join("\n")}\n`, encoding: "utf8", maxBuffer: 1 << 28 });
    for (const line of revList.split("\n")) {
      const [c, ...parents] = line.split(" ").filter(Boolean);
      if (!c) continue;
      inGraph.add(c);
      for (const p of parents) (children.get(p) ?? children.set(p, []).get(p)).push(c);
    }
    for (const r of runTips) if (!inGraph.has(r)) throw new Error(`git rev-list did not list the run commit ${r}`);
    const descendants = new Map(); // sorted holding commits -> Set of their descendants (themselves included)
    const descendantsOf = (xs) => {
      const key = [...xs].sort().join(" ");
      if (!descendants.has(key)) {
        const seen = new Set(xs.filter((x) => inGraph.has(x))); // a commit outside the graph is no ancestor of a run commit
        const stack = [...seen];
        while (stack.length)
          for (const ch of children.get(stack.pop()) ?? [])
            if (!seen.has(ch)) {
              seen.add(ch);
              stack.push(ch);
            }
        descendants.set(key, seen);
      }
      return descendants.get(key);
    };
    const eff = effectiveAmendments(registryFile);
    amendments.forEach((a, i) => {
      const xs = holding.get(canonical(a)) ?? [];
      const after = descendantsOf(xs);
      for (const r of runCommits)
        if (!after.has(r.commit))
          problems.push(`amendments[${i}] (${a.path}, decision ${eff[i].decision}) is not in the history of the held-out run record ${r.where}: an amendment must be committed before every held-out run (an ancestor of its start record's commit)${xs.length ? "" : "; it is not committed at all"}`);
    });
  }
  return problems;
}

// owner/repo from https, ssh or www URLs, lower-cased, without .git
export function repoSlug(url) {
  const m = String(url).toLowerCase().match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : String(url).toLowerCase();
}

// Apply `replaced` in order. Each entry swaps the CURRENT occupant of a primary slot (the primary itself, or a
// reserve swapped in earlier) for the next unused reserve. Returns { slots, problems, used }.
function applySwaps(m) {
  const problems = [];
  const reserves = (m.reserves?.repos ?? []).map((r) => r.name);
  const byName = new Map([...m.repos, ...(m.reserves?.repos ?? [])].map((r) => [r.name, r]));
  const slots = m.repos.map((r) => r.name);
  (m.replaced ?? []).forEach((e, i) => {
    if (!e.date || !e.reason) problems.push(`replaced[${i}] needs date and reason`);
    const slot = slots.indexOf(e.repo);
    if (slot < 0) problems.push(`replaced[${i}]: its repo does not occupy a slot (it is not a primary or a reserve swapped in earlier, or it was replaced already)`);
    if (e.reserve !== reserves[i]) problems.push(`replaced[${i}]: must use the next unused reserve (${reserves[i] ? `reserves[${i}]` : "none left"}), not the one it names`);
    if (slot >= 0 && byName.has(e.reserve)) slots[slot] = e.reserve;
  });
  return { slots: slots.map((n) => byName.get(n)), problems, used: new Set(reserves.slice(0, (m.replaced ?? []).length)) };
}

// Check the append-only lists against the core. Returns a list of problems.
//   replaced: [{date, repo, reserve, reason}]  the i-th swap uses the i-th reserve, for a slot's current occupant
//   burned:   [{date, name, reason}]           a repo that motivated product work and moved to the dev set
//   exposed:  [{name, where}]                  a repo whose conventions were named where product engineers can read
export function checkManifestLists(m) {
  const p = [...applySwaps(m).problems];
  const all = new Set([...m.repos, ...(m.reserves?.repos ?? [])].map((r) => r.name));
  const burned = new Set();
  (m.burned ?? []).forEach((e, i) => {
    if (!e.date || !e.reason) p.push(`burned[${i}] needs date and reason`);
    if (!all.has(e.name)) p.push(`burned[${i}]: names no repo or reserve of this manifest`);
    if (burned.has(e.name)) p.push(`burned[${i}]: listed twice`);
    burned.add(e.name);
  });
  // Messages name list positions, never repos: they can reach CI logs.
  for (const [i, e] of (m.exposed ?? []).entries()) if (!all.has(e.name)) p.push(`exposed[${i}]: names no occupant, reserve or replaced repo of this manifest`);
  return p;
}

// The repos a held-out run measures: each slot's current occupant, minus burned repos.
export function effectiveRepos(m) {
  const burned = new Set((m.burned ?? []).map((e) => e.name));
  return applySwaps(m).slots.filter((r) => r && !burned.has(r.name));
}

// Everything that is still held-out: the repos measured, plus reserves not yet swapped in (minus burned).
// Replaced repos are not held-out any more (they may be dev repos: that is why they were replaced).
export function heldOutRepos(m) {
  const { used } = applySwaps(m);
  const burned = new Set((m.burned ?? []).map((e) => e.name));
  return [...effectiveRepos(m), ...(m.reserves?.repos ?? []).filter((r) => !used.has(r.name) && !burned.has(r.name))];
}

// ---------- blind dev pools ----------
// A blind dev pool (PLAN-R10 section 3.1, PLAN-R11 section 4.1) is drawn like a held-out set and is not build-set data
// while it is blind. It joins the build set after its report (PLAN-R10 section 3.4, PLAN-R11 sections 0 and 4.2): from
// then on its committed run records may be read and its labels may count. The tools check that by the report file
// being in the tree, never by a pool's name: a pool whose report is missing, and a pool this table does not know, are
// refused. (A held-out set never joins: held-out paths are refused always.)
export const BLIND_POOLS = {
  dev3: { report: "eval/study/runs/dev3-ts-2026-11-08/dev3-check.md" },
  dev4: { report: "eval/study/runs/dev4-ts-2026-11-09/dev4-check.md" },
  // PREREG-F12-dev5-py-check.md: Python only; its report is committed at this path.
  dev5: { report: "eval/study/runs/dev5-py/dev5-check.md" },
};
// The pools a path, a repo name (`dev3:P04`) or any text names: `dev<n>` at its start or after one of / _ . : -
// (so `dev-v3-relabel5` names none).
export const blindPoolsNamed = (text) => [...new Set([...String(text).matchAll(/(?:^|[/_.:-])(dev\d+)/gim)].map((m) => m[1].toLowerCase()))].sort();
// Why `pool` is not build-set data, or null when its report is in the tree.
export function blindPoolProblem(pool, exists = existsSync) {
  const p = BLIND_POOLS[pool];
  if (!p) return `${pool}: a blind dev pool this checkout does not know (lib.mjs BLIND_POOLS)`;
  return exists(join(repoRootDir, p.report)) ? null : `${pool}: a blind dev pool whose report (${p.report}) is not in the tree: not build-set data yet`;
}
