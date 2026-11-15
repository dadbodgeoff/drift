// Experimental wiring rules (#38): registered_in and mirrors_keys, the `wire` hint on
// violations, census's registries and co-change history, and the hook advice.
import { describe, expect, it } from "vitest";
import { conventionRows, historyStatus, isWiringRule, parseConventions, registryStatus, ruleFamily, ruleTargets, wireAt, wireFix, wireTitle, wiringState } from "@/entities/convention";
import { classifyDrift, parseTranscript, sessionStats } from "@/entities/session";
import type { WireHint } from "@/shared/contract/drift";
import { census, check, text, transcriptFor } from "./helpers";

describe("wiring rules (#38)", () => {
  it("have the Wiring family and chips that say where", () => {
    const reg = { type: "registered_in" as const, slot: "arg:pkg:@nestjs/common#Module@0:providers", path: "src/app.module.ts" };
    expect(ruleFamily(reg)).toBe("Wiring");
    expect(ruleTargets(reg)).toEqual(["registered in src/app.module.ts"]);
    expect(ruleTargets({ type: "registered_in", slot: "x", named: "*_JOB_DEFINITION" })).toEqual(["registered in a list of its kind", "names *_JOB_DEFINITION"]);
    const keys = { type: "mirrors_keys" as const, from: ".env.example", to: "apps/web/env.ts" };
    expect(ruleFamily(keys)).toBe("Wiring");
    expect(ruleTargets(keys)).toEqual(["keys of .env.example also in apps/web/env.ts"]);
    expect(isWiringRule(keys) && isWiringRule(reg) && !isWiringRule({ type: "calls" })).toBe(true);
  });

  it("word the fix as Drift does (check.rs WireHint::describe)", () => {
    const w: WireHint = { action: "register", path: "src/app.module.ts", line: 8, label: "Module() providers", like: { name: "UsersService", line: 9, path: "src/users/users.service.ts" } };
    expect(wireFix(w, "BillingService")).toBe("add BillingService to Module() providers in src/app.module.ts:8 (like UsersService, line 9)");
    expect(wireFix({ ...w, line: 0, label: "re-exports", like: { name: "Button", line: 0 } }, "Card")).toBe("add Card to re-exports in src/app.module.ts (like Button)");
    expect(wireFix({ ...w, like: null }, "X")).toBe("add X to Module() providers in src/app.module.ts:8");
    expect(wireAt({ path: "a.ts", line: 0 })).toBe("a.ts");
    expect([wireTitle({ action: "register" }), wireTitle({ action: "mirror" }), wireTitle({ action: "other" })]).toEqual(["Not registered", "Key not mirrored", "Not wired (other)"]);
  });

  it("explain each registry status and history state, and show unknown ones as Drift spells them", () => {
    expect(["proposed", "subsumed", "below_threshold", "opaque"].map((s) => registryStatus(s).label)).toEqual(["proposed", "subsumed", "below threshold", "opaque"]);
    expect(registryStatus("proposed", 0.9).why).toContain("90%");
    expect(registryStatus("autodiscovered:import.meta.glob")).toMatchObject({ label: "autodiscovered" });
    expect(registryStatus("autodiscovered:import.meta.glob").why).toContain("import.meta.glob");
    expect(registryStatus("brand_new").label).toBe("brand_new");
    for (const h of ["read", "shallow", "partial_clone", "no_git", "failed", "timeout", "too_large"]) expect(historyStatus(h).why.length).toBeGreaterThan(10);
    expect(historyStatus("read").ok).toBe(true);
    expect(historyStatus("timeout").ok).toBe(false);
  });

  it("the acme fixture, from the real binary with the flag on: registries, two accepted rules that never block, and one unregistered service", () => {
    const c = census();
    expect(wiringState(c)).toBe("on");
    expect(wiringState({})).toBe("off");
    expect(wiringState(null)).toBe("unknown");
    const providers = c.wiring!.registries!.find((r) => r.label === "Module() providers")!;
    expect(providers).toMatchObject({ path: "apps/api/src/app.module.ts", status: "proposed" });
    // PayoutsService (the human edit) is the one service it does not name.
    expect(providers.members - providers.covered).toBe(1);
    expect(c.wiring!.cochange?.history).toBeDefined();

    const rows = conventionRows(parseConventions(text("acme/conventions.yaml")), c, check()).filter((r) => r.experimental);
    expect(rows.map((r) => r.ruleKind)).toEqual(["registered_in", "registered_in"]);
    for (const r of rows) {
      expect(r).toMatchObject({ family: "Wiring", status: "accepted", tier: "suggestion", tierReason: "rule_kind", blockable: false, effectiveMode: "advise" });
      expect(r.wiring?.registry?.path).toBe("apps/api/src/app.module.ts");
    }

    const v = check().violations.find((x) => x.wire)!;
    expect(v.symbol).toBe("PayoutsService");
    expect(v.wire).toMatchObject({ action: "register", path: "apps/api/src/app.module.ts", label: "Module() providers", entry: { symbol: "PayoutsService" } });
    expect(v.mode).toBe("advise");
    expect(wireFix(v.wire!, v.wire!.entry!.symbol)).toMatch(/^add PayoutsService to Module\(\) providers in apps\/api\/src\/app\.module\.ts:\d+ \(like \w+, line \d+\)$/);
  });

  it("recognises the hook advice, and since W0 the agent gets none for a wiring suggestion", () => {
    // Since W0 (#110) a wiring suggestion is not shown to agents (its family is not in the admission table), so the
    // regenerated Refunds session (round 9 F) has no wiring advice; the text, when a person shows one to agents, is still read.
    const t = parseTranscript(transcriptFor(/Refunds API/).text);
    expect(t.events.filter((e) => e.type === "hook" && e.drift?.kind === "unwired")).toEqual([]);
    expect(sessionStats(t).drift.unwired).toBe(0);
    expect(classifyDrift("drift: code added in the last turn may not be wired up yet (advice; ignore it if that is intentional).\n- [D-43b8c8] apps/api/src/payouts/payouts.service.ts PayoutsService")?.kind).toBe("unwired");
  });
});
