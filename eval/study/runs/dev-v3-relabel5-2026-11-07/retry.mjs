// retry.mjs <part> <labeller> <repo> <key>: write p/<key>.retry.md for a relaunch: the validator's latest problems for
// this prompt (paraphrase-free: the validator's own words, record numbers only), plus, for EVERY card of the prompt
// (not only the failing ones, so the list hints at nothing), the files that can hold a member of its role according to
// the validator (lib.mjs memberFileInfo: tracked, non-config, within the role's parts, not the example's or outliers').
// Reads no label and no output.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const WT = "/home/user/drift-wt/relabel5";
const { memberFileInfo, loadRun, CONFIG_FILE, shuffle } = await import(join(WT, "eval/study/lib.mjs"));
const S = "/tmp/claude-0/-home-user/55356579-373d-5769-975f-dff3ec91dfc9/scratchpad/relabel5";
const [part, L, repo, key] = process.argv.slice(2);
const runDir = join(WT, "eval/study/runs/dev-v3-relabel5-2026-11-07", part, "relabel");
const { run, queue } = loadRun(runDir);
const idx = JSON.parse(readFileSync(join(runDir, "prompts/index.json"), "utf8"));
const e = idx.find((x) => x.stage === "label" && x.labeller === L && x.repo === repo);
const probs = (e.rejected ?? []).at(-1)?.problems ?? [];
const info = memberFileInfo(run, { items: queue.items.filter((q) => q.repo === repo) });
const CAP = 25;
const lines = [
  "# Before you write your output again",
  "",
  "Your earlier output for this prompt was not accepted by the validator. It was set aside unread; nobody has seen your labels. Do the task again from the start, following the prompt, and write the COMPLETE output (every record) to the same output file.",
  "",
  "Only list in `checked` files you actually opened and read. Never add files to `checked` with a script or without opening them.",
  "",
  "## What the validator said (record = line number of your earlier out.jsonl)",
  "",
  ...probs.map((p) => `- ${p}`),
  "",
  "## Files that can hold other members of each card's role",
  "",
  "For rubric v3 \"What to open\" 3, the validator counts as an \"other member\" only a tracked, non-config file that can hold a member of the card's role, other than the example's and the outliers' files. Below, for every card of this prompt (failing or not), are such files" + ` (at most ${CAP} per card, in a fixed random order).` + " They are where members can be, not a judgement of any card: open the ones you need, check that they hold members, and judge the card yourself.",
  "",
];
for (const q of queue.items.filter((x) => x.repo === repo).sort((a, b) => a.uid.localeCompare(b.uid))) {
  const i = info.get(q.uid);
  const skip = new Set([q.example?.split("#")[0], ...(q.outlier_files ?? [])]);
  if (!i || !i.candidates) {
    lines.push(`### ${q.uid}`, "", "(the validator cannot bound this role's files: any member file of the role counts)", "");
    continue;
  }
  const c = [...i.candidates].filter((f) => !skip.has(f) && !CONFIG_FILE.test(f) && i.tracked.has(f));
  const pick = shuffle(c, `${q.uid}:retry`).slice(0, CAP);
  lines.push(`### ${q.uid}`, "", `${c.length} such files${c.length > CAP ? `; ${CAP} of them` : ""}:`, "", ...pick.map((f) => `- ${f}`), "");
}
const out = join(S, "p", `${key}.retry.md`);
writeFileSync(out, lines.join("\n"));
console.log(`${key} ${part} ${L} ${repo}: ${probs.length} problems -> ${out}`);
