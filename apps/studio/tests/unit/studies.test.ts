import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { abByModel, acceptRate, agreement, decisionsOf, describeVariant, firstRound, languageAdvisesOnly, latestAndEarlier, modelName, noDefaultTier, parseFamilyRows, parseCoverageRun, parseLabels, parseRun, parseShift, precision, readRuns, rubricChanged, rubricLabel, sortRuns, tierDefinition, tierLabel } from "@/entities/study";
import { channels } from "@/shared/ipc/contract";
import type { AbRow, Census } from "@/shared/contract/drift";
import { json, text } from "./helpers";

const ix = json<{ studies: { census: string[]; ab: string[] } }>("index.json");
const census: Record<string, Census> = Object.fromEntries(ix.studies.census.map((n) => [n, json<Census>(`studies/census-${n}.json`)]));

describe("precision study", () => {
  const labels = parseLabels(text("studies/labels.jsonl"));
  const p = precision(firstRound(labels.rows), census);

  it("reproduces the study's headline numbers", () => {
    expect(labels.malformed).toBe(0);
    expect(p.overall.n).toBe(181);
    expect(Math.round((acceptRate(p.overall) ?? 0) * 100)).toBe(60);
    const wrappers = p.byFamily.find((f) => f.family === "Call wrappers")!;
    expect(Math.round((acceptRate(wrappers) ?? 0) * 100)).toBe(91);
  });

  it("computes agreement with the second opinion", () => {
    const a = agreement(firstRound(labels.rows), parseLabels(text("studies/second-opinion.jsonl")).rows);
    expect(a.n).toBe(40);
    expect(a.kappa).toBeCloseTo(0.51, 1);
  });
});

describe("precision study from eval/study/labels.jsonl (the source)", () => {
  const src = parseLabels(readFileSync(new URL("../../../../eval/study/labels.jsonl", import.meta.url), "utf8"));
  it("keeps the round, and the fixture is a prefix of the source (labels are only ever appended)", () => {
    expect(src.rows.filter((r) => r.round).length).toBeGreaterThanOrEqual(57);
    const source = readFileSync(new URL("../../../../eval/study/labels.jsonl", import.meta.url), "utf8");
    expect(source.startsWith(text("studies/labels.jsonl"))).toBe(true);
  });
  it("tallies the first round alone: 108 accept, 29 trivial, 43 wrong", () => {
    const o = precision(firstRound(src.rows), census).overall;
    expect({ accept: o.accept, trivial: o.trivial, wrong: o.wrong }).toEqual({ accept: 108, trivial: 29, wrong: 43 });
  });
  it("would be wrong if the double-label round were mixed in (latest label wins)", () => {
    const mixed = precision(src.rows, census).overall;
    expect(mixed.accept).not.toBe(108);
  });
});

describe("agent A/B", () => {
  it("puts arms side by side per model", () => {
    const sets = ix.studies.ab.map((name) => ({ name, rows: json<AbRow[]>(`studies/results-${name}.json`) }));
    const models = abByModel(sets);
    expect(models.map((m) => modelName(m.model))).toEqual(["Haiku 5.5", "Opus 5.5"]);
    for (const m of models) {
      expect(Object.keys(m.arms).sort()).toEqual(["control", "drift"]);
      expect(m.arms.control.runs).toBe(9);
      expect(m.tasks).toHaveLength(9);
    }
  });
});

describe("study runs (eval/study/runs/*/metrics.json, #22, #24, #25)", () => {
  const ix = json<{ studies: { runs: string[] } }>("index.json");
  const runs = sortRuns(ix.studies.runs.map((p) => parseRun(p, json(`studies/runs/${p.replace(/^eval\/study\/runs\//, "")}/metrics.json`))!));

  it("reads every run and view, newest and relabelled first", () => {
    expect(runs.every(Boolean)).toBe(true);
    expect(runs.filter((r) => !r.name.startsWith("calib-")).map((r) => r.name)[0]).toBe("dev-v3-relabel4-2026-11-07");
    const order = ["dev-v3-relabel4-2026-11-07", "dev-v3-relabel3-2026-11-07", "dev-v3-relabel2-2026-11-07", "dev-v3-relabel-2026-11-06", "dev-v3-2026-11-06", "dev-ts-r2-2026-11-05"].map((n) => runs.findIndex((r) => r.name === n));
    expect(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]))).toBe(true);
    expect(runs.findIndex((r) => r.name === "dev-py-r2-2026-11-05")).toBeLessThan(runs.findIndex((r) => r.name === "dev-py-2026-11-05"));
  });

  it("has #25's rule-kind tier figures and the per-language D1/D4 cells", () => {
    const v = runs.find((r) => r.name === "dev-ts-r2-2026-11-05" && r.view === "rule5")!;
    expect(v.tier?.kind).toBe("rule_kind");
    expect([v.defaultTier.accept, v.defaultTier.trivial, v.defaultTier.wrong, v.defaultTier.shown]).toEqual([77, 5, 10, 92]);
    expect(v.defaultTier.acceptShown?.p).toBeCloseTo(0.837, 3);
    expect(tierDefinition(v)).toMatch(/rule kind in the allowlist/);
    const g = v.byLanguage![0];
    expect(g.language).toBe("typescript/javascript");
    // Dev runs get no verdict: D1 and D4 are judged on primary held-out runs only.
    expect(g.target).toMatchObject({ threshold: 0.95, met: null });
    expect(g.notWrongTarget).toMatchObject({ threshold: 0.95, met: null });
    expect(runs.find((r) => r.name === "dev-py-r2-2026-11-05" && !r.view)!.language).toBe("python");
  });

  it("reads verdicts, the sensitivity table and failed repos when a run has them, and tolerates older runs", () => {
    const r = parseRun("eval/study/runs/x", {
      run: "x",
      headline_eligible: true,
      manifest: { path: "eval/holdout-primary-py.json", role: "primary", language: "python" },
      tier: { definition: { kind: "rule_kind", default: { rule_kinds: ["wrapped_by:call"], min_members: 15 } }, min_members: 15, pre_registered: true },
      overall: { shown: 10 },
      default_tier: { shown: 5, ACCEPT: 5, accept_shown: { k: 5, n: 5, p: 1, lo: 0.57, hi: 1 } },
      by_language: [{ language: "python", repos: ["a"], overall: {}, default_tier: {}, suggestion_tier: {}, target: { criterion: "D1", threshold: 0.95, default_tier_accept: 1, met: true }, not_wrong_target: { criterion: "D4", threshold: 0.95, not_wrong: 0.9, met: false } }],
      sensitivity: { without: ["cs146s_cn"], by_language: [{ language: "python", removed: ["cs146s_cn"], with: {}, without: {} }] },
      failed_repos: [{ name: "b", status: "census_failed" }],
    })!;
    expect(r.byLanguage![0].target?.met).toBe(true);
    expect(r.byLanguage![0].notWrongTarget?.met).toBe(false);
    expect(r.sensitivity?.without).toEqual(["cs146s_cn"]);
    expect(r.failedRepos).toEqual([{ name: "b", status: "census_failed" }]);
    expect(parseRun("p", { run: "old", overall: {}, default_tier: {} })?.byLanguage).toBeNull();
    expect(parseRun("p", { nope: 1 })).toBeNull();
  });
});

describe("one unreadable run never hides the others", () => {
  it("lists a metrics.json without `run`, or that failed to read, as unreadable with why", () => {
    const good = json(`studies/runs/dev-ts-r2-2026-11-05/metrics.json`);
    const { runs, unreadable } = readRuns([
      { path: "eval/study/runs/dev-ts-r2-2026-11-05", metrics: good },
      { path: "eval/study/runs/broken", metrics: { nope: 1 } },
      { path: "eval/study/runs/torn", error: "metrics.json could not be read: Unexpected end of JSON input" },
    ]);
    expect(runs.map((r) => r.name)).toEqual(["dev-ts-r2-2026-11-05"]);
    expect(unreadable).toEqual([
      { path: "eval/study/runs/broken", reason: expect.stringMatching(/no `run` field/) },
      { path: "eval/study/runs/torn", reason: expect.stringMatching(/Unexpected end/) },
    ]);
  });

  it("the IPC response accepts any run object, so a bad one cannot fail the whole studies response", () => {
    const r = channels.loadStudies.res.parse({ source: "s", labels: "", secondOpinion: null, census: {}, ab: [], runs: [{ path: "a", metrics: { nope: 1 } }, { path: "b", error: "x" }] });
    expect(r?.runs).toHaveLength(2);
  });
});

describe("rubric v3 (D6), calibration and dev sets (#29)", () => {
  const ix = json<{ studies: { runs: string[] } }>("index.json");
  const extra = json<{ calibrations: { path: string; shift: unknown; agreements: { path: string; agreement: unknown }[] }[]; manifests: { path: string; repos: number }[] }>("studies/extra.json");
  const calib = extra.calibrations.map((c) => c.path);
  const { runs } = readRuns(
    ix.studies.runs.map((p) => ({ path: p, metrics: json(`studies/runs/${p.replace(/^eval\/study\/runs\//, "")}/metrics.json`), calibration: calib.some((c) => p.startsWith(c)) })),
  );

  it("reads each run's rubric, and says when figures side by side were labelled under different rubrics", () => {
    const ts = runs.find((r) => r.name.startsWith("calib-") && r.view === "ts")!;
    expect(ts).toMatchObject({ calibration: true, rubric: { version: "v3", mixed: false, labels: { v3: 37 } } });
    expect(ts.rubric.sha256).toMatch(/^[0-9a-f]{64}$/);
    const dev = runs.find((r) => r.name === "dev-ts-r2-2026-11-05" && !r.view)!;
    expect(rubricLabel(dev.rubric)).toBe("not recorded");
    expect(rubricChanged([ts, dev])).toBe(true);
    expect(rubricChanged([dev, dev])).toBe(false);
    expect(rubricLabel({ version: null, sha256: null, mixed: true, labels: { v2: 120, v3: 40 } })).toBe("mixed (v2 120, v3 40)");
  });

  it("lists the decisions the runs record, D6 with its rubric", () => {
    const ds = decisionsOf(runs);
    expect(ds.map((d) => d.id)).toEqual(expect.arrayContaining(["D1", "D2", "D3", "D4", "D5", "D5a", "D6"]));
    expect(ds.map((d) => d.id).indexOf("D5a")).toBe(ds.map((d) => d.id).indexOf("D5") + 1);
    expect(ds.find((d) => d.id === "D6")?.rubricSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads a calibration's shift matrix and κ, and the labeller agreement per part", () => {
    const c = extra.calibrations[0];
    const shift = parseShift(c.shift)!;
    expect(shift.n).toBe(61);
    expect(shift.kappa).toBeCloseTo(0.384, 3);
    expect(shift.confusion.ACCEPT.WRONG).toBe(18);
    const ts = parseShift(c.agreements.find((a) => a.path.endsWith("/ts"))!.agreement)!;
    expect(ts.kappa).toBeCloseTo(0.934, 3);
  });

  it("lists the second Python dev manifest, labelled since the v3 relabel (#44)", () => {
    const py2 = extra.manifests.find((m) => m.path === "eval/repos-py-2.json")!;
    expect(py2.repos).toBe(12);
    expect(runs.filter((r) => r.manifest === "eval/repos-py-2.json").map((r) => r.path).sort()).toEqual(["eval/study/runs/dev-v3-2026-11-06/py2/views/d5", "eval/study/runs/dev-v3-2026-11-06/py2/views/d7", "eval/study/runs/dev-v3-relabel3-2026-11-07/py2", "eval/study/runs/dev-v3-relabel4-2026-11-07/py2"]);
    expect(extra.manifests.every((m) => m.path.startsWith("eval/repos"))).toBe(true);
  });
});

describe("calibration is what metrics.json `kind` says (#29 c6b0052)", () => {
  it("a precision run with a stray shift.json is not a calibration; kind: calibration is, with its named files", () => {
    const { runs } = readRuns([
      { path: "eval/study/runs/dev-x/ts", metrics: { run: "eval/study/runs/dev-x/ts", kind: "precision" }, calibration: true },
      { path: "eval/study/runs/calib-y/py", metrics: { run: "eval/study/runs/calib-y/py", kind: "calibration", calibration: { shift: "eval/study/runs/calib-y/shift.json", agreement: "eval/study/runs/calib-y/py/agreement.json" } } },
      // Written before `kind`: the shift.json beside it is the only sign.
      { path: "eval/study/runs/calib-old/ts", metrics: { run: "eval/study/runs/calib-old/ts" }, calibration: true },
    ]);
    const by = (n: string) => runs.find((r) => r.name === n)!;
    expect(by("dev-x").calibration).toBe(false);
    expect(by("calib-y")).toMatchObject({ calibration: true, calibrationFiles: { shift: "eval/study/runs/calib-y/shift.json", agreement: "eval/study/runs/calib-y/py/agreement.json" } });
    expect(by("calib-old").calibration).toBe(true);
  });
});

describe("the v3 dev relabel at its real depth (#44: <run>/<part>/views/d5)", () => {
  const ix = json<{ studies: { runs: string[]; variants?: { path: string; variant: string }[] } }>("index.json");
  const extra = json<{ calibrations: { path: string }[]; agreements: { path: string; agreement: unknown }[]; exclusions: { path: string; excluded: unknown }[] }>("studies/extra.json");
  const at = (p: string, v?: string) => `studies/runs/${p.replace(/^eval\/study\/runs\//, "")}/${v ? `metrics-${v}` : "metrics"}.json`;
  const calib = extra.calibrations.map((c) => c.path);
  const raw = [
    ...ix.studies.runs.map((p) => ({ path: p, metrics: json(at(p)), calibration: calib.some((c) => p.startsWith(c)) })),
    ...(ix.studies.variants ?? []).map((v) => ({ path: v.path, variant: v.variant, metrics: json(at(v.path, v.variant)) })),
  ];
  const { runs, unreadable } = readRuns(raw, extra);
  const { earlier } = latestAndEarlier(runs);
  // #44's round (no longer the newest since the relabel rounds; their cards are below), one representative per part.
  const v3 = ["ts", "py", "py2"].map((p) => earlier.find((r) => r.name === "dev-v3-2026-11-06" && r.part === p)!);
  const part = (p: string) => v3.find((r) => r.part === p)!;

  it("finds every part's view under the product's tier (D7), rubric v3, without a hard-coded layout", () => {
    expect(unreadable).toEqual([]);
    expect(v3.map((r) => `${r.name}/${r.part}/${r.viewName}`)).toEqual(["dev-v3-2026-11-06/ts/d7", "dev-v3-2026-11-06/py/d7", "dev-v3-2026-11-06/py2/d7"]);
    expect(v3.map((r) => r.language)).toEqual(["typescript/javascript", "python", "python"]);
    for (const r of v3) {
      expect(r.rubric).toMatchObject({ version: "v3", mixed: false });
      expect(r.tier).toMatchObject({ kind: "rule_kind", target: "in_repo", preRegistered: false, decision: "D7", languages: ["ts"], ruleKinds: ["wrapped_by:call", "avoids:import"] });
      expect(tierDefinition(r)).toMatch(/^default tier \(D7\): TypeScript\/JavaScript only \(Python advises only\), rule kind wrapped_by:call or avoids:import/);
      expect(tierLabel(r)).toBe("D7 tier");
    }
    expect(part("py2").manifest).toBe("eval/repos-py-2.json");
    // The D5 views are still read, and labelled as D5's.
    const d5 = runs.filter((r) => r.name === "dev-v3-2026-11-06" && r.viewName === "d5");
    expect(d5.map((r) => r.part).sort()).toEqual(["py", "py2", "ts"]);
    for (const r of d5) {
      expect(r.tier).toMatchObject({ decision: "D5", languages: null });
      expect(tierLabel(r)).toBe("D5 tier");
      expect(tierDefinition(r)).toMatch(/\(D5\)/);
    }
  });

  it("per part: default-tier accept and not-wrong over all shown, with Wilson and cluster intervals, and A/B κ", () => {
    const fig = (p: string) => {
      const r = part(p);
      return [r.defaultTier.acceptShown!.k, r.defaultTier.acceptShown!.n, Math.round(r.defaultTier.acceptShown!.p! * 1000) / 10, Math.round(r.overall.notWrongShown!.p! * 1000) / 10];
    };
    // D7 on #44's labels: ts 75.0% (24/32); the Python parts have no default tier. Not wrong (both tiers) is unchanged: 43.2%, 38.5%, 31.6%.
    expect(fig("ts")).toEqual([24, 32, 75, 43.2]);
    expect(noDefaultTier(part("ts"))).toBe(false);
    for (const [p, nw] of [["py", 38.5], ["py2", 31.6]] as const) {
      const r = part(p);
      expect(r.defaultTier.shown).toBe(0);
      expect(noDefaultTier(r)).toBe(true);
      expect(Math.round(r.overall.notWrongShown!.p! * 1000) / 10).toBe(nw);
    }
    // D5's view keeps #44's figures: ts 67.3% (35/52), py 30.0% (3/10), py2 42.9% (6/14).
    const d5 = (p: string) => runs.find((r) => r.name === "dev-v3-2026-11-06" && r.part === p && r.viewName === "d5")!.defaultTier.acceptShown!;
    expect(["ts", "py", "py2"].map((p) => [d5(p).k, d5(p).n])).toEqual([[35, 52], [3, 10], [6, 14]]);
    {
      const a = part("ts").defaultTier.acceptShown!;
      expect(a.lo).toBeLessThan(a.p!);
      expect(a.boot?.clusters).toBeGreaterThanOrEqual(2);
      expect(a.t?.clusters).toBe(a.boot?.clusters);
    }
    expect(v3.map((r) => r.agreement?.kappa)).toEqual([0.84, 0.64, 0.79].map((k) => expect.closeTo(k, 2)));
    expect(part("py").agreement?.n).toBe(18);
  });

  it("shows the CTFd exclusion as data, and the Python figures with and without CTFd", () => {
    expect(part("py").exclusions).toEqual([
      { path: "eval/study/runs/dev-v3-2026-11-06/py/relabel/adjudication", repos: ["CTFd"], uids: ["CTFd/D-560792", "CTFd/D-f6c1fb"], reason: expect.stringMatching(/excluded from this run/), at: expect.any(String) },
    ]);
    expect(part("ts").exclusions).toEqual([]);
    expect(part("py2").exclusions).toEqual([]);
    // metrics-without-CTFd.json is folded into its run, not listed as another run.
    const py = part("py");
    expect(py.variants.map((v) => v.variant)).toEqual(["without-CTFd"]);
    expect(runs.filter((r) => r.path === py.path)).toHaveLength(1);
    expect(py.exposure?.exposed).toEqual(["CTFd"]);
    expect(py.exposure!.cleanTier.shown).toBe(0); // D7: no Python default tier, with or without CTFd
    expect(py.exposure!.clean.notWrongShown!.p).toBeCloseTo(0.405, 3);
    const d5 = runs.find((r) => r.path === "eval/study/runs/dev-v3-2026-11-06/py/views/d5")!;
    expect([d5.exposure!.cleanTier.acceptShown!.k, d5.exposure!.cleanTier.acceptShown!.n]).toEqual([3, 8]); // D5: 37.5% without CTFd
  });

  it("keeps the r2 rounds, marked as labelled under another rubric", () => {
    const r2 = earlier.filter((r) => /-r2-/.test(r.name));
    expect(r2.map((r) => `${r.name}/${r.view}`)).toEqual(expect.arrayContaining(["dev-ts-r2-2026-11-05/rule5", "dev-py-r2-2026-11-05/rule5-py"]));
    for (const r of r2) expect(rubricLabel(r.rubric)).not.toBe("v3");
    const { latest } = latestAndEarlier(runs);
    expect(rubricChanged(latest)).toBe(false);
    expect(rubricChanged([latest[0], r2[0]])).toBe(true);
    // r2's relabel agreement belongs to r2, not to the v3 parts.
    expect(r2.find((r) => r.name === "dev-ts-r2-2026-11-05")?.agreement?.n).toBeGreaterThan(0);
  });

  it("a run with an `excluded` list carries it, on its own part only; a deeper or unknown layout still reads", () => {
    const m = (run: string) => ({ run, kind: "precision", overall: { shown: 4 }, default_tier: { shown: 2 } });
    const { runs } = readRuns(
      [
        { path: "eval/study/runs/dev-x-2027-01-01/a/b/views/v", metrics: m("eval/study/runs/dev-x-2027-01-01/a/b/views/v") },
        { path: "eval/study/runs/dev-x-2027-01-01/c/views/v", metrics: m("eval/study/runs/dev-x-2027-01-01/c/views/v") },
        { path: "eval/study/runs/dev-x-2027-01-01/c/views/v", variant: "broken", error: "metrics-broken.json could not be read: x" },
      ],
      { exclusions: [{ path: "eval/study/runs/dev-x-2027-01-01/a/b/relabel/adjudication", excluded: { repos: ["R"], uids: ["R/D-1"], reason: "why" } }] },
    );
    const ab = runs.find((r) => r.part === "a/b")!;
    expect(ab.viewName).toBe("v");
    expect(ab.exclusions).toEqual([{ path: "eval/study/runs/dev-x-2027-01-01/a/b/relabel/adjudication", repos: ["R"], uids: ["R/D-1"], reason: "why", at: null }]);
    expect(runs.find((r) => r.part === "c")!.exclusions).toEqual([]);
    expect(readRuns([{ path: "p", variant: "v", error: "e" }]).unreadable).toEqual([{ path: "p (metrics-v.json)", reason: "e" }]);
  });
});

describe("relabel rounds 1 to 3 (#71, #87): a part that holds its view's scoring, and a variant of it", () => {
  const ix = json<{ studies: { runs: string[]; variants?: { path: string; variant: string }[] } }>("index.json");
  const at = (p: string, v?: string) => `studies/runs/${p.replace(/^eval\/study\/runs\//, "")}/${v ? `metrics-${v}` : "metrics"}.json`;
  const raw = [...ix.studies.runs.map((p) => ({ path: p, metrics: json(at(p)) })), ...(ix.studies.variants ?? []).map((v) => ({ path: v.path, variant: v.variant, metrics: json(at(v.path, v.variant)) }))];
  const { runs } = readRuns(raw);
  const { earlier } = latestAndEarlier(runs);
  // Relabel 3 is an earlier round since relabel 4 (#104): one representative per part, below the newest cards.
  const r3 = ["ts", "py", "py2"].map((p) => earlier.find((r) => r.name === "dev-v3-relabel3-2026-11-07" && r.part === p)!);
  const part = (p: string) => r3.find((r) => r.part === p)!;

  it("shows relabel3's full scoring per part (ts/metrics.json is metrics.mjs on ts/views/d7), not the carried-only variant", () => {
    expect(r3.map((r) => r.path)).toEqual(["ts", "py", "py2"].map((p) => `eval/study/runs/dev-v3-relabel3-2026-11-07/${p}`));
    for (const r of r3) {
      expect(r.variant).toBeNull();
      expect(r.scoredAs).toBe(`${r.path}/views/d7`);
      expect(tierLabel(r)).toBe("D7 tier");
      // metrics-carried-only.json (in views/d7) is folded into the scoring of the same run, never a card of its own.
      expect(r.variants.map((v) => v.variant)).toEqual(["carried-only"]);
    }
    expect(runs.some((r) => r.variant)).toBe(false);
    // The D7 default tier on relabel3's final labels: ts 29/29; the carried labels alone would read 26 of 29.
    const d = part("ts").defaultTier;
    expect([d.accept, d.shown, d.unlabelled]).toEqual([29, 29, 0]);
    expect(part("ts").variants[0].defaultTier.accept).toBe(26);
    for (const p of ["py", "py2"]) expect(noDefaultTier(part(p))).toBe(true);
    expect(part("ts").byLanguage!.find((g) => g.language === "typescript/javascript")!.families.length).toBeGreaterThan(0);
    // The earlier relabel rounds stay listed, newest first: relabel3's parts, then relabel2 and the first relabel.
    expect([...new Set(earlier.map((r) => r.name))].slice(0, 3)).toEqual(["dev-v3-relabel3-2026-11-07", "dev-v3-relabel2-2026-11-07", "dev-v3-relabel-2026-11-06"]);
  });

  it("describes relabel3's carried-only variant as a variant of its run: earlier rounds' labels only, relabelled cards as WRONG", () => {
    for (const p of ["ts", "py", "py2"]) {
      const r = part(p);
      const v = r.variants[0];
      expect(r.labels).toBe(`${r.path}/final.jsonl`);
      expect(v.labels).toBe(`${r.path}/carried.jsonl`);
      const info = describeVariant(v, r);
      expect(info).toMatchObject({ name: "carried-only", kind: "carried", file: `${r.path}/views/d7/metrics-carried-only.json` });
      expect(info.meaning).toContain("carried over from earlier rounds (carried.jsonl)");
      expect(info.meaning).toContain(`(${v.overall.unlabelled} of ${v.overall.shown} shown)`);
      expect(info.meaning).toContain("counted as WRONG");
      expect(info.meaning).toContain("the run's result is its own scoring, with final.jsonl");
      // Same cards, fewer labels.
      expect(v.overall.shown).toBe(r.overall.shown);
      expect(v.overall.unlabelled).toBeGreaterThan(r.overall.unlabelled);
    }
    // ts: 20 cards relabelled in this round (README: 158 shown, 138 carried).
    expect([part("ts").variants[0].overall.shown, part("ts").variants[0].overall.unlabelled]).toEqual([158, 20]);
  });

  it("describes an exposure variant as the exposure check, and any other variant as not the run's result", () => {
    const dev = runs.find((r) => r.path === "eval/study/runs/dev-v3-2026-11-06/py/views/d7")!;
    const x = describeVariant(dev.variants[0], dev);
    expect(x).toMatchObject({ name: "without-CTFd", kind: "exposure" });
    expect(x.meaning).toContain("without CTFd (metrics.mjs --exclude-repos)");
    const base = parseRun("eval/study/runs/r/views/v", { run: "eval/study/runs/r/views/v", labels: "a.jsonl" })!;
    const other = parseRun("eval/study/runs/r/views/v", { run: "eval/study/runs/r/views/v", labels: "b.jsonl" }, { variant: "b" })!;
    expect(describeVariant(other, base)).toMatchObject({ kind: "other", meaning: expect.stringContaining("labels in b.jsonl instead of a.jsonl") });
    const bare = parseRun("eval/study/runs/r/views/v", { run: "eval/study/runs/r/views/v" }, { variant: "z" })!;
    expect(describeVariant(bare, null)).toMatchObject({ kind: "other", meaning: expect.stringContaining("metrics-z.json") });
  });

  it("a variant with no scoring of its run anywhere stays listed but never stands for the run", () => {
    const m = (run: string, decision: string) => ({ run, kind: "precision", tier: { definition: { kind: "rule_kind", decision, default: {} } }, overall: { shown: 4 }, default_tier: { shown: 2 } });
    const { runs } = readRuns([
      { path: "eval/study/runs/dev-y-2027-01-01/ts/views/d7", variant: "subset", metrics: m("eval/study/runs/dev-y-2027-01-01/ts/views/d7", "D7") },
      { path: "eval/study/runs/dev-y-2027-01-01/ts/views/d5", metrics: m("eval/study/runs/dev-y-2027-01-01/ts/views/d5", "D5") },
    ]);
    expect(runs.map((r) => r.variant)).toEqual([null, "subset"]);
    expect(latestAndEarlier(runs).latest.map((r) => r.viewName)).toEqual(["d5"]);
  });
});

describe("relabel round 4 (#104): the newest TypeScript and Python run", () => {
  const ix = json<{ studies: { runs: string[]; variants?: { path: string; variant: string }[] } }>("index.json");
  const ex = json<{ agreements: { path: string; agreement: unknown }[]; exclusions: { path: string; excluded: unknown }[] }>("studies/extra.json");
  const at = (p: string, v?: string) => `studies/runs/${p.replace(/^eval\/study\/runs\//, "")}/${v ? `metrics-${v}` : "metrics"}.json`;
  const raw = [...ix.studies.runs.map((p) => ({ path: p, metrics: json(at(p)) })), ...(ix.studies.variants ?? []).map((v) => ({ path: v.path, variant: v.variant, metrics: json(at(v.path, v.variant)) }))];
  const { runs, unreadable } = readRuns(raw, ex);
  const { latest, earlier } = latestAndEarlier(runs);
  const part = (p: string) => latest.find((r) => r.part === p)!;

  it("is the latest round for every part (ts, py, py2), scored as views/d7 with final labels, D7 tier, rubric v3", () => {
    expect(unreadable).toEqual([]);
    expect(latest.map((r) => r.path)).toEqual(["ts", "py", "py2"].map((p) => `eval/study/runs/dev-v3-relabel4-2026-11-07/${p}`));
    expect(latest.map((r) => r.manifest)).toEqual(["eval/repos.json", "eval/repos-py.json", "eval/repos-py-2.json"]);
    for (const r of latest) {
      expect(r.variant).toBeNull();
      expect(r.scoredAs).toBe(`${r.path}/views/d7`);
      expect(r.labels).toBe(`${r.path}/final.jsonl`);
      expect(r.rubric).toMatchObject({ version: "v3", mixed: false });
      expect(tierLabel(r)).toBe("D7 tier");
      expect(r.overall.unlabelled).toBe(0); // README: every shown proposal is labelled
      expect(r.variants.map((v) => v.variant)).toEqual(["carried-only"]);
    }
  });

  it("has the README's Results: ts default tier 30/30, suggestion 62/117, all shown 92/147; Python advises only", () => {
    const ts = part("ts");
    expect([ts.defaultTier.accept, ts.defaultTier.shown, ts.defaultTier.unlabelled]).toEqual([30, 30, 0]);
    expect([ts.suggestionTier!.accept, ts.suggestionTier!.shown]).toEqual([62, 117]);
    expect([ts.overall.accept, ts.overall.shown]).toEqual([92, 147]);
    for (const p of ["py", "py2"]) expect(noDefaultTier(part(p))).toBe(true);
    // "Python proposals only": py 12 of 21, py2 19 of 42 (each Python dev repo set also holds TypeScript cards).
    const python = (p: string) => part(p).byLanguage!.find((g) => g.language === "python")!.overall;
    expect([python("py").accept, python("py").shown]).toEqual([12, 21]);
    expect([python("py2").accept, python("py2").shown]).toEqual([19, 42]);
    const wrappers = ts.byLanguage!.find((g) => g.language === "typescript/javascript")!.families.find((f) => f.family === "wrapper")!;
    expect([wrappers.overall.shown, wrappers.overall.accept, wrappers.defaultTier.accept, wrappers.defaultTier.shown]).toEqual([21, 20, 20, 20]);
  });

  it("carries each part's agreement (README: ts 80.0%, κ 0.65 over 25; py 3/4; py2 92.9%, κ 0.84 over 14) and no exclusion", () => {
    expect(latest.map((r) => r.agreement?.n)).toEqual([25, 4, 14]);
    expect(latest.map((r) => r.agreement?.exact)).toEqual([0.8, 0.75, 13 / 14].map((e) => expect.closeTo(e, 6)));
    expect(part("ts").agreement?.kappa).toBeCloseTo(0.65, 2);
    expect(part("py2").agreement?.kappa).toBeCloseTo(0.84, 2);
    for (const r of latest) expect(r.exclusions).toEqual([]);
  });

  it("folds carried-only into its run: the 25 ts cards relabelled this round are unlabelled there", () => {
    const v = part("ts").variants[0];
    expect(v.labels).toBe("eval/study/runs/dev-v3-relabel4-2026-11-07/ts/carried.jsonl");
    expect([v.overall.shown, v.overall.unlabelled, v.defaultTier.accept, v.defaultTier.unlabelled]).toEqual([147, 25, 28, 2]);
    expect(describeVariant(v, part("ts")).meaning).toContain("(25 of 147 shown)");
    expect(runs.some((r) => r.variant)).toBe(false);
  });

  it("keeps relabel 3 and the earlier rounds listed below it, newest first", () => {
    expect([...new Set(earlier.map((r) => r.name))].slice(0, 4)).toEqual(["dev-v3-relabel3-2026-11-07", "dev-v3-relabel2-2026-11-07", "dev-v3-relabel-2026-11-06", "dev-v3-2026-11-06"]);
    expect(earlier.filter((r) => r.name === "dev-v3-relabel3-2026-11-07").map((r) => r.part).sort()).toEqual(["py", "py2", "ts"]);
    expect(earlier.some((r) => r.name === "dev-v3-relabel4-2026-11-07")).toBe(false);
  });
});

describe("coverage runs (eval/study/apps-coverage.mjs metrics.json)", () => {
  const cov = { repos: 3, failed: [], packages: { total: 9 }, root_default: { silent_root: { repos: 2, of: 3 }, packages_with_shown: { packages: 1, of: 9 } } };
  it("are listed apart, not unreadable and not a round", () => {
    const { runs, unreadable, coverage } = readRuns([
      { path: "eval/study/runs/pool-cov", metrics: cov },
      { path: "eval/study/runs/junk", metrics: { repos: 3 } },
    ]);
    expect(runs).toEqual([]);
    expect(coverage).toEqual([{ path: "eval/study/runs/pool-cov", repos: 3, silentRoot: { repos: 2, of: 3 }, packages: { total: 9, withShown: 1 } }]);
    expect(unreadable.map((u) => u.path)).toEqual(["eval/study/runs/junk"]);
  });
  it("never take a scoring's place: a metrics.json with a run field is a run", () => {
    expect(parseCoverageRun("p", { ...cov, run: "r" })).toBeNull();
    expect(parseCoverageRun("p", { run: "r" })).toBeNull();
  });
});

describe("the committed eval/study/runs, read as the desktop app reads them", () => {
  it("parses every run, folds every variant into its run, and shows no variant as a round", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join, resolve } = await import("node:path");
    const { StudioMain } = await import("../../electron/handlers");
    const { Store } = await import("../../electron/store");
    const root = resolve(__dirname, "../../../..");
    const tmp = mkdtempSync(join(tmpdir(), "studio-eval-"));
    const m = new StudioMain({ store: new Store(join(tmp, "d")), projectsDir: tmp, user: "t", appVersion: "0", platform: "linux", dialogs: { chooseDirectory: async () => root, chooseFile: async () => null, chooseSavePath: async () => null } });
    const s = (await m.loadStudies({ choose: true }))!;
    const { runs, unreadable, coverage } = readRuns(s.runs, s);
    expect(unreadable).toEqual([]);
    // Coverage runs (apps-coverage.mjs) are listed apart, never as a round or as unreadable.
    for (const c of coverage) expect(c.repos).toBeGreaterThan(0);
    expect(runs.some((r) => coverage.some((c) => c.path === r.path))).toBe(false);
    expect(runs.filter((r) => r.variant).map((r) => r.path)).toEqual([]);
    const { latest } = latestAndEarlier(runs);
    expect(latest.length).toBeGreaterThan(0);
    for (const r of latest) {
      expect(r.variant).toBeNull();
      expect(r.rubric.version).toBe("v3");
    }
  });
});

describe("per-language rule families (metrics.json by_language[].families[], #68)", () => {
  const at = (p: string) => json(`studies/runs/${p}/metrics.json`);
  const ts = parseRun("eval/study/runs/dev-v3-2026-11-06/ts/views/d7", at("dev-v3-2026-11-06/ts/views/d7"))!;
  const py = parseRun("eval/study/runs/dev-v3-2026-11-06/py/views/d7", at("dev-v3-2026-11-06/py/views/d7"))!;
  const lang = (r: typeof ts, l: string) => r.byLanguage!.find((g) => g.language === l)!;

  it("maps each family's all-shown, default-tier and suggestion-tier figures, with Wilson and cluster intervals", () => {
    const g = lang(ts, "typescript/javascript");
    expect(g.families).toHaveLength(13);
    const w = g.families.find((f) => f.family === "wrapper")!;
    expect(w.name).toBe("Call wrappers");
    expect([w.overall.shown, w.defaultTier.shown, w.suggestionTier.shown]).toEqual([20, 19, 1]);
    expect(w.defaultTier.acceptShown).toMatchObject({ k: 14, n: 19 });
    expect(w.defaultTier.acceptShown!.p).toBeCloseTo(14 / 19, 6);
    expect(w.defaultTier.acceptShown!.lo).toBeLessThan(w.defaultTier.acceptShown!.p!);
    expect(w.overall.acceptShown!.boot?.clusters).toBe(8);
    expect(w.overall.notWrongShown!.p).toBeCloseTo(0.7, 6);
    // Only call wrappers and layering are in the D7 default tier; the families add up to the language's row.
    expect(g.families.filter((f) => f.defaultTier.shown).map((f) => f.family).sort()).toEqual(["layering", "wrapper"]);
    for (const k of ["overall", "defaultTier", "suggestionTier"] as const) expect(g.families.reduce((a, f) => a + f[k].shown, 0)).toBe(g[k].shown);
  });

  it("lists the most shown family first", () => {
    const shown = lang(ts, "typescript/javascript").families.map((f) => f.overall.shown);
    expect(shown).toEqual(shown.slice().sort((a, b) => b - a));
    expect(lang(ts, "typescript/javascript").families[0].family).toBe("naming");
  });

  it("gives a tier with n = 0 no rate, and says when a language advises only (D7)", () => {
    const g = lang(py, "python");
    const w = g.families.find((f) => f.family === "wrapper")!;
    expect(w.defaultTier.shown).toBe(0);
    expect(w.defaultTier.acceptShown).toMatchObject({ n: 0, p: null });
    expect(w.suggestionTier.acceptShown).toMatchObject({ k: 2, n: 2 });
    expect(g.families.every((f) => f.defaultTier.shown === 0)).toBe(true);
    // Unlabelled proposals (CTFd's) count as WRONG in the shown rates.
    const b = g.families.find((f) => f.family === "base_class")!;
    expect([b.overall.unlabelled, b.overall.acceptShown?.n]).toEqual([2, 6]);
    expect(languageAdvisesOnly(py, "python")).toBe(true);
    expect(languageAdvisesOnly(py, "typescript/javascript")).toBe(false);
    expect(languageAdvisesOnly(ts, "typescript/javascript")).toBe(false);
  });

  it("gives older runs none, without failing: the committed r2 metrics.json predates #68", () => {
    const old = JSON.parse(readFileSync(new URL("../../../../eval/study/runs/dev-ts-r2-2026-11-05/metrics.json", import.meta.url), "utf8"));
    expect(old.by_language.every((g: Record<string, unknown>) => !("families" in g))).toBe(true);
    const r = parseRun("eval/study/runs/dev-ts-r2-2026-11-05", old)!;
    expect(r.byLanguage!.length).toBeGreaterThan(0);
    expect(r.byLanguage!.every((g) => g.families.length === 0)).toBe(true);
    expect(parseRun("p", { run: "older", overall: {}, default_tier: {}, by_language: [{ language: "python" }] })!.byLanguage![0].families).toEqual([]);
  });

  it("reads a family with n = 0, a missing tier, or no name without failing, and drops entries that are not families", () => {
    const rows = parseFamilyRows([
      { family: "naming", name: "Naming", overall: { shown: 0, accept_shown: { k: 0, n: 0, p: null, lo: null, hi: null } }, default_tier: {}, suggestion_tier: {} },
      { family: "calls", overall: { shown: 3, ACCEPT: 1, accept_shown: { k: 1, n: 3, p: 1 / 3, lo: 0.06, hi: 0.79 } } },
      null,
      "x",
      {},
    ]);
    expect(rows.map((f) => [f.family, f.name, f.overall.shown])).toEqual([
      ["calls", "calls", 3],
      ["naming", "Naming", 0],
    ]);
    expect(rows[0].defaultTier).toMatchObject({ shown: 0, acceptShown: null, notWrongShown: null });
    expect(rows[1].overall.acceptShown).toMatchObject({ n: 0, p: null });
    expect(parseFamilyRows(undefined)).toEqual([]);
    expect(parseFamilyRows({ not: "an array" })).toEqual([]);
  });
});
