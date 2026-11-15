import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { checkLabel } from "../../../lib.mjs";
const [L, who] = process.argv.slice(2);
const rows = readFileSync(`${L}/rows.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const byUid = new Map();
for (const r of rows) {
  const ex = /^\s*example:\s+(\S+)/m.exec(r.proposal)?.[1];
  const outs = [...r.proposal.matchAll(/^\s*outlier:\s+(\S+?):\d+/gm)].map((m) => m[1]);
  byUid.set(r.key, { example: ex, outlier_files: [...new Set(outs)] });
}
const idx = JSON.parse(readFileSync(`${L}/index-${who}.json`, "utf8"));
let n = 0, bad = 0;
for (const i of idx) {
  const extra = readdirSync(dirname(i.out)).filter((f) => f !== "out.jsonl");
  const cwd = readdirSync(i.cwd);
  if (extra.length || cwd.length) console.log("ISOLATION", i.prompt, extra, cwd);
  if (!existsSync(i.out)) { console.log("MISSING", i.prompt); bad++; continue; }
  const got = readFileSync(i.out, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const keys = got.map((r) => r.uid).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...i.keys].sort())) console.log("KEYS", i.prompt, keys, i.keys);
  for (const r of got) {
    n++;
    const p = checkLabel({ ...r, labeller: who }, { labeller: who, byUid, rubric: "v3", expectRubric: "v3" });
    if (p.length) { bad++; console.log("INVALID", r.uid, i.repo_dir.split("/").pop(), p.join("; ")); }
  }
}
console.log(who, "records", n, "problems", bad);
