import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { unknownCommandError, validateCommandShape } from "../src/args/command-shape.js";
import type { ParsedArgs } from "../src/app/command-types.js";

/**
 * W4/D-CL3: the CLI's command surface is enumerated three times and nothing compared the lists.
 *
 * `router.ts` decides what a command DOES. `unknownCommandError` decides whether it EXISTS.
 * `validateCommandShape` decides how many positionals it may carry. All three are hand-written
 * `group === "x" && command === "y"` chains, and they can disagree in two directions, both of
 * which are silent:
 *
 *   - the router handles a command `unknownCommandError` rejects, so a working command is
 *     unreachable and reports "Unknown command";
 *   - `unknownCommandError` accepts a command the router does not handle, so it falls through
 *     to whatever the final branch does instead of saying it does not exist.
 *
 * Cross-checked by reading the router's own source for the pairs it routes, rather than by
 * restating them here - a fourth hand-maintained list would be the same defect with one more
 * copy of it.
 */

const ROUTER_SOURCE = readFileSync(
  fileURLToPath(new URL("../src/app/router.ts", import.meta.url)),
  "utf8"
);
const SHAPE_SOURCE = readFileSync(
  fileURLToPath(new URL("../src/args/command-shape.ts", import.meta.url)),
  "utf8"
);
/**
 * The FOURTH enumeration, which the audit named three of. `doctor`, `capabilities` and `restore`
 * are dispatched in run-cli.ts BEFORE the router is reached, on `parsed.positional[0]`, so the
 * router legitimately never branches on them. Found by this test failing on all three.
 */
const RUN_CLI_SOURCE = readFileSync(
  fileURLToPath(new URL("../src/app/run-cli.ts", import.meta.url)),
  "utf8"
);

function parsedFor(positional: string[]): ParsedArgs {
  return { positional, flags: new Map() };
}

/**
 * Every command the router branches on, as the positionals that reach it.
 *
 * Four of them are three-level (`policy agent grant`, `conventions exception add`,
 * `contract waiver show`, `contract waivers list`), and their branch tests `maybeId` in the same
 * condition. Probing those with two positionals reports a disagreement that is not one - the
 * first version of this test did exactly that and named all four - so the third level is read
 * out of the branch rather than assumed absent.
 */
function routedCommands(): Array<{ label: string; positional: string[] }> {
  const commands = new Map<string, { label: string; positional: string[] }>();
  const pattern =
    /group === "([a-z-]+)"\s*&&\s*command === "([a-z-]+)"(?:[^\n]*?maybeId === "([a-z-]+)")?/g;
  for (const [, group, command, maybeId] of ROUTER_SOURCE.matchAll(pattern)) {
    const positional = maybeId ? [group, command, maybeId] : [group, command];
    const label = positional.join(" ");
    // A pair reached by several branches keeps the most specific one seen.
    if (!commands.has(label)) {
      commands.set(label, { label, positional });
    }
  }
  return [...commands.values()];
}

/** Every group dispatched anywhere: the router's branches plus run-cli.ts's pre-router ones. */
function routedGroups(): string[] {
  return [
    ...new Set([
      ...[...ROUTER_SOURCE.matchAll(/group === "([a-z-]+)"/g)].map((match) => match[1]),
      ...[...RUN_CLI_SOURCE.matchAll(/parsed\.positional\[0\] === "([a-z-]+)"/g)].map((match) => match[1])
    ])
  ];
}

describe("command surface parity", () => {
  it("reads the router's own branches rather than a restated list", () => {
    // Liveness, the BB-8 shape: if the regex stops matching - because the router is rewritten
    // into a table, say - every assertion below passes vacuously and this gate reports success
    // forever. Fail instead, so the gate is rewritten with the thing it reads.
    expect(routedGroups().length).toBeGreaterThan(8);
    expect(
      [...RUN_CLI_SOURCE.matchAll(/parsed\.positional\[0\] === "([a-z-]+)"/g)].length,
      "run-cli.ts pre-router dispatch no longer parses"
    ).toBeGreaterThan(2);
    expect(routedCommands().length).toBeGreaterThan(15);
  });

  it("recognizes every command the router routes", () => {
    // Direction one: a command that works but reports "Unknown command".
    const unrecognized = routedCommands().filter(
      ({ positional }) => unknownCommandError(parsedFor(positional)) !== null
    );
    expect(
      unrecognized.map(({ label }) => label),
      "router routes these, unknownCommandError rejects them"
    ).toEqual([]);
  });

  it("accepts the positional arity of every command the router routes", () => {
    // Direction two: `validateCommandShape` rejecting the exact shape the router is built to
    // receive. An arity rule stricter than the router's branch makes a routed command
    // unreachable, and the error names an argument rather than the disagreement.
    const rejected: string[] = [];
    for (const { label, positional } of routedCommands()) {
      try {
        validateCommandShape(parsedFor(positional));
      } catch (error) {
        rejected.push(`${label}: ${(error as Error).message}`);
      }
    }
    expect(rejected, "router routes these, validateCommandShape rejects their base shape").toEqual([]);
  });

  it("routes every group command-shape.ts claims to recognize", () => {
    // The reverse direction: a group `unknownCommandError` accepts but the router never branches
    // on falls through to the final branch instead of reporting that it does not exist.
    //
    // Read from command-shape.ts, NOT from the router. The first version of this test took both
    // sides from ROUTER_SOURCE and so compared the file to itself - it passed for the same reason
    // it could never fail.
    const routed = new Set(routedGroups());
    const claimed = [
      ...new Set([...SHAPE_SOURCE.matchAll(/group === "([a-z-]+)"/g)].map((match) => match[1]))
    ];
    expect(claimed.length, "command-shape.ts source no longer parses").toBeGreaterThan(8);
    expect(
      claimed.filter((group) => !routed.has(group)),
      "command-shape.ts recognizes these groups, the router never routes them"
    ).toEqual([]);
  });
});
