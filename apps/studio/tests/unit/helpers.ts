import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { Census, CheckReport, Inventory, RepoFacts } from "@/shared/contract/drift";

const F = new URL("../../fixtures/", import.meta.url);
export const text = (p: string) => readFileSync(new URL(p, F), "utf8");
export const json = <T>(p: string) => JSON.parse(text(p)) as T;
export const facts = () => JSON.parse(gunzipSync(readFileSync(new URL("acme/facts.json.gz", F))).toString("utf8")) as RepoFacts;
export const census = () => json<Census>("acme/census.json");
export const check = () => json<CheckReport>("acme/check.json");
export const security = () => json<Inventory>("acme/security.json");
export const index = () => json<{ sessions: { id: string; title: string; hasState: boolean }[] }>("index.json");
export const transcriptFor = (title: RegExp) => {
  const s = index().sessions.find((x) => title.test(x.title))!;
  return { id: s.id, text: text(`acme/transcripts/${s.id}.jsonl`), state: s.hasState ? json(`acme/sessions/${s.id}.json`) : null };
};
