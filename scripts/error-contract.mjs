#!/usr/bin/env node
/**
 * The failure-code contract has one source of truth, and the docs must match it.
 *
 * Three things have to agree: the `DriftFailureCode` union, the `FAILURE_CONTRACT` table that
 * assigns each code an exit code and an `error.type`, and the table in docs/reference/errors.md
 * that tells users what to expect. Before this gate they did not, and nothing noticed:
 *
 *   - `missing_contract` and `insufficient_disk` were documented as exit-3 refusals and exited 1,
 *     because `exitCode` was an option on each throw site defaulting to 1 and those two omitted it;
 *   - `missing_engine` was never constructed as a DriftError at all, so it exited 1 structurally;
 *   - seven of nineteen codes were undocumented;
 *   - and cli.test.ts asserted `exitCode: 1` directly above `code: "missing_contract"`, so the
 *     tests had frozen the wrong behaviour and the docs lost silently.
 *
 * Checked statically because the union, the table and the document are all source. The runtime
 * half - that a thrown code actually produces its exit code - is covered by the CLI suite, which
 * exercises the real binary; this gate exists to stop the three lists diverging in the first place.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ERROR_SOURCE = join(repoRoot, "packages/cli/src/app/drift-error.ts");
const DOC = join(repoRoot, "docs/reference/errors.md");

/** Members of the `DriftFailureCode` union. */
function declaredCodes(source) {
  const union = source.slice(
    source.indexOf("export type DriftFailureCode ="),
    source.indexOf("export const FAILURE_CONTRACT")
  );
  return [...union.matchAll(/\|\s*"([a-z_]+)"/g)].map((match) => match[1]);
}

/** Entries of the FAILURE_CONTRACT table, as { code, exitCode, type }. */
function contractEntries(source) {
  const start = source.indexOf("export const FAILURE_CONTRACT");
  const table = source.slice(start, source.indexOf("\n};", start));
  return [...table.matchAll(/([a-z_]+):\s*\{\s*exitCode:\s*(\d)\s*,\s*type:\s*"(refusal|error)"\s*\}/g)].map(
    (match) => ({ code: match[1], exitCode: Number(match[2]), type: match[3] })
  );
}

/** Codes named in the docs' code table, and the codes its refusal paragraph lists. */
function documented(doc) {
  const rows = [...doc.matchAll(/^\|\s*`([a-z_]+)`\s*\|/gm)].map((match) => match[1]);
  const refusalSection = doc.slice(doc.indexOf("The refusals are"));
  const refusals = [...refusalSection.slice(0, refusalSection.indexOf("\n\n")).matchAll(/`([a-z_]+)`/g)].map(
    (match) => match[1]
  );
  return { rows, refusals };
}

function main() {
  const source = readFileSync(ERROR_SOURCE, "utf8");
  const doc = readFileSync(DOC, "utf8");

  const codes = declaredCodes(source);
  const entries = contractEntries(source);
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const { rows, refusals } = documented(doc);
  const failures = [];

  for (const code of codes) {
    if (!byCode.has(code)) {
      failures.push(
        `${code} is declared in DriftFailureCode but absent from FAILURE_CONTRACT, so its exit code would be undefined.`
      );
    }
    if (!rows.includes(code)) {
      failures.push(`${code} is not documented in docs/reference/errors.md. Add a row for it.`);
    }
  }

  for (const entry of entries) {
    if (!codes.includes(entry.code)) {
      failures.push(`${entry.code} is in FAILURE_CONTRACT but is not a DriftFailureCode.`);
    }
    const expectedExit = entry.type === "refusal" ? 3 : 1;
    if (entry.exitCode !== expectedExit) {
      failures.push(
        `${entry.code} is type "${entry.type}" but exits ${entry.exitCode}. A refusal exits 3 and an error exits 1; they cannot disagree.`
      );
    }
    const documentedRefusal = refusals.includes(entry.code);
    if (entry.type === "refusal" && !documentedRefusal) {
      failures.push(
        `${entry.code} exits 3 as a refusal but the docs do not list it as one. This is the D-E1 shape: the table and the document disagreeing about the same code.`
      );
    }
    if (entry.type === "error" && documentedRefusal) {
      failures.push(
        `${entry.code} exits 1 but the docs list it among the refusals. Remove it there, or make it a refusal here.`
      );
    }
  }

  for (const row of rows) {
    if (!codes.includes(row)) {
      failures.push(`docs/reference/errors.md documents ${row}, which is not a DriftFailureCode.`);
    }
  }

  const refusalCount = entries.filter((entry) => entry.type === "refusal").length;
  console.log(
    `error contract: ${codes.length} codes, ${refusalCount} refusals (exit 3), ` +
      `${entries.length - refusalCount} errors (exit 1), ${rows.length} documented.`
  );

  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
}

main();
