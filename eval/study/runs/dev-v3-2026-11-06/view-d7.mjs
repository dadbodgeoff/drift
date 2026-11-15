// Writes views/d7/ for each part of the v3 dev relabel: the part with decision D7's tier (eval/study/tier-d7.json)
// applied as a derived view, beside views/d5/ (stage.mjs). Nothing in the part changes: run.json, queue.json and the
// labels are read as they are. Run from the root of the checkout, then score each view with metrics.mjs:
//
//   node eval/study/runs/dev-v3-2026-11-06/view-d7.mjs
//   R=eval/study/runs/dev-v3-2026-11-06
//   for P in ts py py2; do
//     node eval/study/metrics.mjs --run $R/$P/views/d7 --labels $R/$P/final.jsonl --json $R/$P/views/d7/metrics.json > $R/$P/views/d7/metrics.md
//   done
//   node eval/study/metrics.mjs --run $R/py/views/d7 --labels $R/py/final.jsonl --exclude-repos CTFd \
//     --json $R/py/views/d7/metrics-without-CTFd.json > $R/py/views/d7/metrics-without-CTFd.md
//
// The member count is the role's size (evidence.role_members from <part>/proposals/<repo>.yaml, else the census total).
// It also writes views/d7/compare.json: per part, the proposals shown, the D5 and D7 default tiers, and which uids
// D7 moves out of D5's default tier, by rule kind and language (lib.mjs proposalLanguage).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkTier, parseYaml, proposalLanguage, readJson, ruleKind, tierMembers, tierOf } from "../../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..", "..");
const rel = (p) => relative(root, p);
const D5 = readJson(join(here, "..", "..", "tier-d5.json")).tier;
const D7 = readJson(join(here, "..", "..", "tier-d7.json")).tier;
if (checkTier(D7).length) throw new Error(`tier-d7.json: ${checkTier(D7).join("; ")}`);

const compare = {};
for (const part of ["ts", "py", "py2"]) {
  const dir = join(here, part);
  const run = readJson(join(dir, "run.json"));
  const queue = readJson(join(dir, "queue.json"));
  // The tier's member count is the role's size (conventions.yaml evidence.role_members, else total), as the product
  // reads it; prepare.mjs at debc33a copied evidence.total, so it is read back from the part's proposals/<repo>.yaml.
  // python_members did not exist at debc33a: the language falls back to the example.
  const yaml = new Map();
  const conv = (p) => {
    if (!yaml.has(p.repo)) {
      const f = join(dir, "proposals", `${p.repo}.yaml`);
      yaml.set(p.repo, new Map(existsSync(f) ? (parseYaml(readFileSync(f, "utf8"))?.conventions ?? []).map((c) => [c.id, c]) : []));
    }
    return yaml.get(p.repo).get(p.id);
  };
  const items = queue.items.map((p) => {
    const e = conv(p)?.evidence;
    const q = { ...p, members: tierMembers(e) ?? p.members, python_members: e?.python_members ?? p.python_members ?? null };
    return { ...q, tier: tierOf(q, D7) };
  });
  const view = {
    ...run,
    run: rel(join(dir, "views", "d7")),
    params: {
      ...run.params,
      tier: D7,
      tier_pre_registered: false,
      tier_pre_registered_note: "derived view: decision D7's tier (eval/study/tier-d7.json) applied after the census; not pre-registered for this dev manifest",
    },
    view_of: { run: run.run, items: "all shown proposals", tier_from: "eval/study/tier-d7.json (decision D7), the tier the product ships and both primary held-out manifests hold" },
  };
  mkdirSync(join(dir, "views", "d7"), { recursive: true });
  writeFileSync(join(dir, "views", "d7", "run.json"), JSON.stringify(view, null, 2) + "\n");
  writeFileSync(join(dir, "views", "d7", "queue.json"), JSON.stringify({ run: view.run, items }, null, 2) + "\n");
  const d5 = new Set(queue.items.filter((p) => tierOf(p, D5) === "default").map((p) => p.uid));
  const d7 = new Set(items.filter((p) => p.tier === "default").map((p) => p.uid));
  const moved = queue.items.filter((p) => d5.has(p.uid) && !d7.has(p.uid));
  const by = (f) => moved.reduce((o, p) => ((o[f(p)] = (o[f(p)] ?? 0) + 1), o), {});
  compare[part] = {
    shown: queue.items.length,
    d5_default: d5.size,
    d7_default: d7.size,
    d7_not_in_d5: [...d7].filter((u) => !d5.has(u)),
    moved_to_suggestion: { count: moved.length, by_rule_kind: by((p) => ruleKind(p.rule) ?? "none"), by_language: by(proposalLanguage), uids: moved.map((p) => p.uid) },
  };
  writeFileSync(join(dir, "views", "d7", "compare.json"), JSON.stringify(compare[part], null, 2) + "\n");
  console.log(`${part}: ${queue.items.length} shown; D5 default ${d5.size}, D7 default ${d7.size}; moved to suggestion ${moved.length} ${JSON.stringify(compare[part].moved_to_suggestion.by_rule_kind)}`);
}
