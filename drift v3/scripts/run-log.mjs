#!/usr/bin/env node
/**
 * Autonomous run log.
 *
 * Append-only JSONL is the source of truth; SUMMARY.md is regenerated from it. Committed after
 * every task so an interruption loses at most one task.
 *
 *   node scripts/run-log.mjs append '<json>'   # record one task outcome
 *   node scripts/run-log.mjs render            # regenerate SUMMARY.md
 *   node scripts/run-log.mjs status            # one-line progress, for resume checks
 *   node scripts/run-log.mjs done T01          # exit 0 if T01 already DONE (resume guard)
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, "../docs/autonomous-run");
const LOG = join(DIR, "log.jsonl");
const SUMMARY = join(DIR, "SUMMARY.md");

const STATUSES = [
  "DONE",
  "DONE_PARTIAL",
  "BLOCKED",
  "SKIPPED_DEPENDENCY",
  "DEFERRED_HUMAN",
  "PREMISE_FALSE",
  "DISCOVERY",
  "BASELINE_CHANGE"
];

function entries() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        return { task: `?line${index + 1}`, status: "BLOCKED", title: "unparseable log line" };
      }
    });
}

function append(raw) {
  const entry = JSON.parse(raw);
  if (!entry.task || !entry.status) {
    throw new Error("append requires at least { task, status }");
  }
  if (!STATUSES.includes(entry.status)) {
    throw new Error(`unknown status ${entry.status}; expected one of ${STATUSES.join(", ")}`);
  }
  appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
  console.log(`logged ${entry.task} ${entry.status}`);
}

const NEEDS_DISCUSSION = new Set(["BLOCKED", "DEFERRED_HUMAN"]);

function render() {
  const all = entries();
  const byStatus = new Map();
  for (const entry of all) {
    byStatus.set(entry.status, [...(byStatus.get(entry.status) ?? []), entry]);
  }

  const lines = ["# Autonomous run summary", ""];
  const done = byStatus.get("DONE") ?? [];
  const partial = byStatus.get("DONE_PARTIAL") ?? [];
  const blocked = byStatus.get("BLOCKED") ?? [];
  const skipped = byStatus.get("SKIPPED_DEPENDENCY") ?? [];
  const deferred = byStatus.get("DEFERRED_HUMAN") ?? [];
  const premiseFalse = byStatus.get("PREMISE_FALSE") ?? [];
  const discoveries = byStatus.get("DISCOVERY") ?? [];
  const baseline = byStatus.get("BASELINE_CHANGE") ?? [];

  lines.push(
    "| Outcome | Count |",
    "|---|---|",
    `| Done | ${done.length} |`,
    `| Done (partial) | ${partial.length} |`,
    `| Premise false (no change needed) | ${premiseFalse.length} |`,
    `| Blocked — needs discussion | ${blocked.length} |`,
    `| Skipped — dependency blocked | ${skipped.length} |`,
    `| Deferred — human-gated | ${deferred.length} |`,
    `| Discoveries | ${discoveries.length} |`,
    `| Baseline changes | ${baseline.length} |`,
    ""
  );

  const section = (title, items, body) => {
    if (items.length === 0) return;
    lines.push(`## ${title}`, "");
    for (const entry of items) lines.push(...body(entry));
    lines.push("");
  };

  section("Completed", [...done, ...partial], (entry) => [
    `- **${entry.task}** ${entry.title ?? ""}${entry.status === "DONE_PARTIAL" ? " _(partial)_" : ""}` +
      (entry.note ? ` — ${entry.note}` : "")
  ]);

  section("Premise false — deliberately no change", premiseFalse, (entry) => [
    `- **${entry.task}** ${entry.title ?? ""}`,
    ...(entry.diagnosis ? [`  - ${entry.diagnosis}`] : [])
  ]);

  section("Discoveries made while working", discoveries, (entry) => [
    `- **${entry.task}** ${entry.title ?? ""}`,
    ...(entry.evidence ? [`  - evidence: ${entry.evidence}`] : [])
  ]);

  section("Baseline changes", baseline, (entry) => [
    `- **${entry.task}** ${entry.title ?? ""}`,
    ...(entry.diagnosis ? [`  - ${entry.diagnosis}`] : [])
  ]);

  section("Skipped — dependency blocked", skipped, (entry) => [
    `- **${entry.task}** ${entry.title ?? ""} — waiting on ${(entry.needs ?? "a blocked prerequisite")}`
  ]);

  section("Deferred — human-gated by design", deferred, (entry) => [
    `- **${entry.task}** ${entry.title ?? ""}${entry.needs ? ` — ${entry.needs}` : ""}`
  ]);

  // The point of the whole run: what needs a human, ranked.
  if (blocked.length > 0) {
    lines.push("## Discussion agenda", "");
    lines.push(
      "Blocked tasks in plan order. Each records what was attempted, the evidence, and the",
      "recommendation. Work reverted; the tree is green.",
      ""
    );
    for (const entry of blocked) {
      lines.push(`### ${entry.task} — ${entry.title ?? ""}`, "");
      if (entry.blocked_reason) lines.push(`- **reason:** ${entry.blocked_reason}`);
      if (entry.attempted) lines.push(`- **attempted:** ${entry.attempted}`);
      if (entry.evidence) lines.push(`- **evidence:** ${entry.evidence}`);
      if (entry.diagnosis) lines.push(`- **diagnosis:** ${entry.diagnosis}`);
      if (entry.needs) lines.push(`- **needs:** ${entry.needs}`);
      if (entry.blocks?.length) lines.push(`- **blocks:** ${entry.blocks.join(", ")}`);
      if (entry.reverted_to) lines.push(`- **reverted to:** \`${entry.reverted_to}\``);
      lines.push("");
    }
  }

  writeFileSync(SUMMARY, `${lines.join("\n")}\n`);
  console.log(
    `rendered ${SUMMARY}: ${done.length} done, ${partial.length} partial, ${blocked.length} blocked, ${deferred.length} deferred`
  );
}

/**
 * Next actionable task, for a self-terminating loop.
 *
 * A task is settled when it is DONE, DONE_PARTIAL, PREMISE_FALSE, BLOCKED or DEFERRED_HUMAN -
 * finished, or recorded with a reason it was not. Exits 1 when nothing actionable remains,
 * which is the loop's stop signal.
 */
function next() {
  const settled = new Set(
    entries()
      .filter((entry) =>
        ["DONE", "DONE_PARTIAL", "PREMISE_FALSE", "BLOCKED", "DEFERRED_HUMAN"].includes(
          entry.status
        )
      )
      .map((entry) => entry.task)
  );

  const planPath = join(DIR, "PLAN.md");
  const plan = existsSync(planPath) ? readFileSync(planPath, "utf8") : "";
  const ids = [...plan.matchAll(/^### (T\d+[a-z]?) /gm)].map((match) => match[1]);
  const remaining = ids.filter((id) => !settled.has(id));

  if (remaining.length === 0) {
    console.log("no actionable tasks remain");
    process.exit(1);
  }
  console.log(remaining[0]);
  const preview = remaining.slice(0, 8).join(", ");
  console.log(`remaining: ${remaining.length} (${preview}${remaining.length > 8 ? ", ..." : ""})`);
  process.exit(0);
}

function status() {
  const all = entries();
  const counts = all.reduce((acc, entry) => {
    acc[entry.status] = (acc[entry.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    Object.entries(counts)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ") || "empty"
  );
}

const [command, argument] = process.argv.slice(2);
if (command === "append") append(argument);
else if (command === "render") render();
else if (command === "status") status();
else if (command === "next") next();
else if (command === "done") {
  const hit = entries().some(
    (entry) => entry.task === argument && (entry.status === "DONE" || entry.status === "PREMISE_FALSE")
  );
  process.exit(hit ? 0 : 1);
} else {
  console.error("usage: run-log.mjs append '<json>' | render | status | next | done <TASK>");
  process.exit(1);
}
