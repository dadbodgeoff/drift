#!/usr/bin/env node
/**
 * W6: the CLI and the MCP server must SHARE a derivation, never keep two of it.
 *
 * `beta:proof` already diffs the two surfaces' payloads and has caught two of the three
 * parser-gap divergences in this remediation. What it cannot see is the structural cause: a
 * derivation implemented twice. It compares OUTPUT on one fixture repo, so a second
 * implementation is invisible until some input tells the two copies apart - and the fixture
 * has to be the input that does it. It was not, three times:
 *
 *   - `buildParserGapSection`: both surfaces wrapped the shared builder in a private,
 *     near-identical function, W4 added `records` to one, and beta:proof went red only because
 *     the field was structurally absent (`cli=[] mcp=undefined`) rather than differently valued.
 *   - `instructionForConvention`: MCP's copy never received CV-5's `presence` branch. beta:proof
 *     is blind to it because its fixture repo accepts no presence-kind convention, so both
 *     copies take the same branch on the only input that is ever compared.
 *   - `preparedConvention`: MCP passed no `referenceFile`, which only changes the answer when
 *     the request names a path that is itself conforming. beta:proof does not send one.
 *
 * So this gate reads the SOURCE, not the output. Every function body in packages/mcp/src is
 * compared against every function body in packages/cli/src; a pair above the similarity
 * threshold is a duplicated derivation and must be either removed or recorded in
 * scripts/surface-parity-baseline.json with a reason.
 *
 * It ratchets in both directions, which is the vocabulary-parity lesson: a NEW pair fails
 * (duplication may not grow), and a baseline entry whose pair no longer duplicates also fails
 * (a stale record is a false claim about the codebase, and it is how a baseline stops
 * describing anything).
 *
 *   node scripts/surface-parity.mjs
 *   node scripts/surface-parity.mjs --update    # rewrite the baseline (reasons are preserved)
 *
 * The census this replaces indexed only symbols carrying a top-level `export`, and recorded
 * that blind spot as an open gap. All three divergences above were module-private. This
 * indexes every function regardless of export, because `export` describes who may call a
 * thing, not whether there are two of it.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const BASELINE = join(HERE, "surface-parity-baseline.json");

const CLI_SRC = join(REPO_ROOT, "packages/cli/src");
const MCP_SRC = join(REPO_ROOT, "packages/mcp/src");

/**
 * Two bodies this similar are the same derivation written twice.
 *
 * 0.85 rather than 1.0 deliberately: an exact-copy check is trivially defeated by a renamed
 * local or a reordered field, and every divergence in this remediation began as an exact copy
 * that someone then edited on ONE side. Catching them only after they are byte-identical is
 * catching them only before they matter.
 */
const SIMILARITY_THRESHOLD = 0.85;

/**
 * Bodies shorter than this are not evidence of a shared derivation.
 *
 * Measured rather than guessed: below ~120 normalized characters the matches are things like
 * `return storage.getRepo(repoId) ?? null;` and one-line type guards, which are similar because
 * there is only one way to write them, not because a derivation was copied.
 */
const MIN_BODY_CHARS = 120;

/** Writes MCP must not perform. The read-only property is structural, so it is checked here. */
const MUTATION_CALL = /\bstorage\s*\.\s*(upsert|append|record|delete)[A-Za-z0-9_]*\s*\(/;

function listTypeScriptFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(full);
    return entry.isFile() && full.endsWith(".ts") && !full.endsWith(".d.ts") ? [full] : [];
  });
}

/**
 * Strip comments and collapse whitespace.
 *
 * Comments are removed because a copy whose comment was reworded is still a copy - and that is
 * the observed shape, not a hypothetical: MCP's `preflightConvention` carried a comment saying
 * it matched "the CLI's preparedConvention" while its body had already diverged.
 */
function normalizeBody(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every `function name(...)` body in a file, by brace matching. */
export function functionsIn(file, source) {
  const out = [];
  const signature = /^[ \t]*(export\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)\s*[(<]/gm;
  let match;
  while ((match = signature.exec(source))) {
    let depth = 0;
    let bodyStart = -1;
    for (let i = signature.lastIndex - 1; i < source.length; i++) {
      const char = source[i];
      if (char === "(" || char === "<" || char === "[") depth++;
      else if (char === ")" || char === ">" || char === "]") depth--;
      else if (char === "{" && depth <= 0) {
        bodyStart = i;
        break;
      }
    }
    if (bodyStart < 0) continue;
    let braces = 0;
    let end = bodyStart;
    for (let i = bodyStart; i < source.length; i++) {
      if (source[i] === "{") braces++;
      else if (source[i] === "}") {
        braces--;
        if (braces === 0) {
          end = i;
          break;
        }
      }
    }
    out.push({
      name: match[3],
      exported: Boolean(match[1]),
      file: relative(REPO_ROOT, file),
      line: source.slice(0, match.index).split("\n").length,
      normalized: normalizeBody(source.slice(bodyStart, end + 1))
    });
  }
  return out;
}

/**
 * Token-multiset overlap (Dice). Chosen over raw string equality so a renamed local or a
 * reordered object literal still scores as the same derivation, and over an edit distance
 * because this runs over ~700 x ~140 pairs on every CI run.
 */
export function similarity(left, right) {
  if (left === right) return 1;
  const tokenize = (value) => value.split(/([^A-Za-z0-9_$]+)/).filter((part) => part.trim());
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const counts = new Map();
  for (const token of leftTokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  let shared = 0;
  for (const token of rightTokens) {
    const remaining = counts.get(token) ?? 0;
    if (remaining > 0) {
      shared++;
      counts.set(token, remaining - 1);
    }
  }
  return (2 * shared) / (leftTokens.length + rightTokens.length);
}

/** Every duplicated pair across the boundary, worst (most similar) first. */
export function duplicatePairs(cliFunctions, mcpFunctions, threshold = SIMILARITY_THRESHOLD) {
  const pairs = [];
  for (const mcpFunction of mcpFunctions) {
    if (mcpFunction.normalized.length < MIN_BODY_CHARS) continue;
    let best = null;
    for (const cliFunction of cliFunctions) {
      if (cliFunction.normalized.length < MIN_BODY_CHARS) continue;
      const score = similarity(mcpFunction.normalized, cliFunction.normalized);
      if (!best || score > best.score) best = { score, cliFunction };
    }
    if (best && best.score >= threshold) {
      pairs.push({
        key: `${mcpFunction.name}<->${best.cliFunction.name}`,
        mcp: `${mcpFunction.file}:${mcpFunction.name}`,
        cli: `${best.cliFunction.file}:${best.cliFunction.name}`,
        similarity: Number(best.score.toFixed(3)),
        both_private: !mcpFunction.exported && !best.cliFunction.exported
      });
    }
  }
  return pairs.sort((left, right) => right.similarity - left.similarity || left.key.localeCompare(right.key));
}

/** MCP source files performing a storage write. The read-only property, checked structurally. */
export function mutationSites(files) {
  return files.flatMap(({ file, source }) =>
    source
      .split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => MUTATION_CALL.test(line))
      .map(({ number }) => `${relative(REPO_ROOT, file)}:${number}`)
  );
}

function main() {
  const update = process.argv.includes("--update");

  const cliFiles = listTypeScriptFiles(CLI_SRC).map((file) => ({ file, source: readFileSync(file, "utf8") }));
  const mcpFiles = listTypeScriptFiles(MCP_SRC).map((file) => ({ file, source: readFileSync(file, "utf8") }));

  const cliFunctions = cliFiles.flatMap(({ file, source }) => functionsIn(file, source));
  const mcpFunctions = mcpFiles.flatMap(({ file, source }) => functionsIn(file, source));

  // Fail rather than pass when the parser finds nothing: a gate that silently stops reading its
  // source reports "no duplicates" forever. This is the shape BB-8's dead cell had.
  if (cliFunctions.length === 0 || mcpFunctions.length === 0) {
    console.error(
      `surface parity: parsed ${cliFunctions.length} CLI and ${mcpFunctions.length} MCP functions. ` +
        `One of them is zero, so this gate is not reading the source it claims to read.`
    );
    process.exit(1);
  }

  const failures = [];

  const writes = mutationSites(mcpFiles);
  if (writes.length > 0) {
    failures.push(
      `MCP performs ${writes.length} storage write(s), and it is structurally read-only:\n` +
        writes.map((site) => `    ${site}`).join("\n")
    );
  }

  const pairs = duplicatePairs(cliFunctions, mcpFunctions);
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const known = new Map((baseline.duplicates ?? []).map((entry) => [entry.key, entry]));

  if (update) {
    const merged = pairs.map((pair) => ({
      ...pair,
      reason: known.get(pair.key)?.reason ?? "TODO: unify this derivation, or state why two copies are correct"
    }));
    writeFileSync(BASELINE, `${JSON.stringify({ duplicates: merged }, null, 2)}\n`);
    console.log(`surface parity baseline updated - ${merged.length} recorded duplicate(s)`);
    process.exit(0);
  }

  const seen = new Set(pairs.map((pair) => pair.key));
  for (const pair of pairs) {
    if (!known.has(pair.key)) {
      failures.push(
        `NEW duplicated derivation across the CLI/MCP boundary (${pair.similarity}):\n` +
          `    mcp ${pair.mcp}\n    cli ${pair.cli}\n` +
          `    Share it through @drift/query or @drift/core. If two copies are genuinely correct, ` +
          `record it in scripts/surface-parity-baseline.json with a reason.`
      );
    }
  }
  for (const key of known.keys()) {
    if (!seen.has(key)) {
      failures.push(
        `STALE baseline entry: ${key} is no longer a duplicated pair. Remove it from ` +
          `scripts/surface-parity-baseline.json - a recorded duplicate that does not exist is a false record.`
      );
    }
  }

  if (failures.length > 0) {
    console.error("surface parity FAILED:\n");
    for (const failure of failures) console.error(`  ${failure}\n`);
    process.exit(1);
  }

  const privateCount = pairs.filter((pair) => pair.both_private).length;
  console.log(
    `surface parity: ${cliFunctions.length} CLI and ${mcpFunctions.length} MCP function bodies compared, ` +
      `${pairs.length} recorded duplicate(s) (${privateCount} module-private), 0 MCP storage writes.`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
