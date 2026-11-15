import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Cvd, contrast, deltaEHex, linear, minPairwise, oklab } from "../src/tokens/color";
import { tokensCss } from "../src/tokens/css";
import { type DirectionName, type ThemeName, defaultDirection, directionNames, directions, themes } from "../src/tokens/index";

// Every theme of every visual direction meets the same bar.
const cases: [DirectionName, ThemeName][] = directionNames.flatMap((d) => (Object.keys(directions[d].themes) as ThemeName[]).map((t) => [d, t] as [DirectionName, ThemeName]));
const SURFACES = ["surface", "sunken", "raised", "overlay", "hover", "selected"] as const;
const TEXT = ["textPrimary", "textSecondary", "textMuted", "accentText"] as const;
const STATES = ["success", "warning", "danger", "info"] as const;

function failures(pairs: [string, string, string, string, number][]) {
  return pairs
    .map(([fgName, bgName, fg, bg, min]) => ({ pair: `${fgName} on ${bgName}`, ratio: Number(contrast(fg, bg).toFixed(2)), min }))
    .filter((p) => p.ratio < p.min);
}

describe.each(cases)("%s / %s: WCAG 2.2 contrast", (dir, name) => {
  const t = directions[dir].themes[name];
  const c = t.color as unknown as Record<string, string>;
  const min = t.textContrast;

  it("declares its own name, scheme and contrast level", () => {
    expect(t.name).toBe(name);
    expect(t.textContrast).toBe(name.endsWith("-hc") ? 7 : 4.5);
    expect(t.scheme).toBe(name.startsWith("light") ? "light" : "dark");
  });

  it("every text role on every surface", () => {
    const pairs: [string, string, string, string, number][] = [];
    for (const fg of TEXT) for (const bg of SURFACES) pairs.push([fg, bg, c[fg], c[bg], min]);
    pairs.push(["accentText", "accentSubtle", c.accentText, c.accentSubtle, min]);
    pairs.push(["textInverse", "accent", c.textInverse, c.accent, min]);
    pairs.push(["textInverse", "accentHover", c.textInverse, c.accentHover, min]);
    expect(failures(pairs)).toEqual([]);
  });

  it("state colours as text on surfaces and on their own subtle background", () => {
    const pairs: [string, string, string, string, number][] = [];
    for (const s of STATES) {
      // Selected rows carry state labels too (a selected session that was blocked).
      for (const bg of ["surface", "raised", "overlay", "selected"]) pairs.push([s, bg, c[s], c[bg], min]);
      pairs.push([s, `${s}Subtle`, c[s], c[`${s}Subtle`], min]);
      pairs.push(["textPrimary", `${s}Subtle`, c.textPrimary, c[`${s}Subtle`], min]);
    }
    expect(failures(pairs)).toEqual([]);
  });

  it("diff and syntax colours on code backgrounds", () => {
    const pairs: [string, string, string, string, number][] = [
      ["diffAddText", "diffAdd", c.diffAddText, c.diffAdd, min],
      ["diffDelText", "diffDel", c.diffDelText, c.diffDel, min],
    ];
    for (const [k, v] of Object.entries(t.syntax)) {
      pairs.push([`syntax.${k}`, "sunken", v, c.sunken, 4.5]);
      pairs.push([`syntax.${k}`, "lineFocus", v, c.lineFocus, 4.5]);
    }
    expect(failures(pairs)).toEqual([]);
  });

  it("control borders, focus ring and data marks reach 3:1 (WCAG 1.4.11)", () => {
    const pairs: [string, string, string, string, number][] = [];
    for (const bg of ["surface", "sunken", "raised", "overlay"]) {
      pairs.push(["borderStrong", bg, c.borderStrong, c[bg], 3]);
      pairs.push(["focus", bg, c.focus, c[bg], 3]);
      pairs.push(["accent", bg, c.accent, c[bg], 3]);
    }
    t.categorical.forEach((v, i) => pairs.push([`categorical[${i}]`, "raised", v, c.raised, 3]));
    expect(failures(pairs)).toEqual([]);
  });
});

describe.each(cases)("%s / %s: hue separation", (dir, name) => {
  const c = directions[dir].themes[name].color as unknown as Record<string, string>;
  it("the accent is far from every state colour (OKLab ΔE ≥ 0.12)", () => {
    const close = STATES.map((s) => ({ s, d: Number(deltaEHex(c.accent, c[s]).toFixed(3)) })).filter((x) => x.d < 0.12);
    expect(close).toEqual([]);
  });
  it("state colours are distinct from each other (ΔE ≥ 0.12)", () => {
    const close: string[] = [];
    for (let i = 0; i < STATES.length; i++)
      for (let j = i + 1; j < STATES.length; j++)
        if (deltaEHex(c[STATES[i]], c[STATES[j]]) < 0.12) close.push(`${STATES[i]}/${STATES[j]}`);
    expect(close).toEqual([]);
  });
});

const baseCases = directionNames.flatMap((d) => (["dark", "light"] as const).map((t) => [d, t] as [DirectionName, "dark" | "light"]));

describe.each(baseCases)("%s / %s: data palettes", (dir, name) => {
  const t = directions[dir].themes[name];
  it.each([undefined, "protanopia", "deuteranopia", "tritanopia"] as (Cvd | undefined)[])("categorical: min pairwise ΔE ≥ 0.09 with %s", (cvd) => {
    const m = minPairwise(t.categorical, cvd);
    expect({ cvd: cvd ?? "normal", ok: m.d >= 0.09, d: Number(m.d.toFixed(3)), pair: m.pair }).toMatchObject({ ok: true });
  });
  it("categorical has 8 colours and sequential has 6", () => {
    expect(t.categorical).toHaveLength(8);
    expect(t.sequential).toHaveLength(6);
  });
  it("sequential runs one way in lightness, away from the surface, and its strongest step reaches 3:1 on raised", () => {
    const L = t.sequential.map((h) => oklab(linear(h))[0]);
    const steps = L.slice(1).map((l, i) => l - L[i]);
    expect(steps.every((s) => Math.abs(s) >= 0.03 && Math.sign(s) === Math.sign(steps[0]))).toBe(true);
    // Magnitude grows away from the background: darker on light themes, lighter on dark ones.
    expect(Math.sign(steps[0])).toBe(name === "light" ? -1 : 1);
    expect(contrast(t.sequential[5], t.color.raised)).toBeGreaterThanOrEqual(3);
  });
});

describe.each(directionNames)("direction %s", (dir) => {
  const d = directions[dir];
  it("is complete: four themes, every font role, every shape token, a thesis", () => {
    expect(Object.keys(d.themes).sort()).toEqual(["dark", "dark-hc", "light", "light-hc"]);
    for (const v of Object.values(d.fonts)) expect(v.length).toBeGreaterThan(3);
    for (const v of Object.values(d.shape)) expect(String(v).length).toBeGreaterThan(0);
    expect(d.thesis.length).toBeGreaterThan(20);
  });
  it("its high-contrast themes keep the base scheme's data palettes", () => {
    expect(d.themes["dark-hc"].categorical).toEqual(d.themes.dark.categorical);
    expect(d.themes["light-hc"].categorical).toEqual(d.themes.light.categorical);
  });
});

it("Chart is the default direction and `themes` is its theme set", () => {
  expect(defaultDirection).toBe("chart");
  expect(directions[defaultDirection].themes).toBe(themes);
});

it("directions are not palette copies: summed ΔE over the identity roles is at least 0.25 in each scheme", () => {
  // Dark themes sit near black, so no single role carries the difference; the
  // sum over shell, cards, linework, selection, ink and accent does.
  const ROLES = ["bg", "raised", "border", "selected", "textPrimary", "accent"] as const;
  const close: string[] = [];
  for (const scheme of ["dark", "light"] as const)
    for (let i = 0; i < directionNames.length; i++)
      for (let j = i + 1; j < directionNames.length; j++) {
        const a = directions[directionNames[i]].themes[scheme].color;
        const b = directions[directionNames[j]].themes[scheme].color;
        const sum = ROLES.reduce((n, r) => n + deltaEHex(a[r], b[r]), 0);
        if (sum < 0.25) close.push(`${scheme}: ${directionNames[i]}/${directionNames[j]} ${sum.toFixed(3)}`);
      }
  expect(close).toEqual([]);
});

it("tokens.css is generated from the tokens (run `npm run tokens -w @drift/ui`)", () => {
  const onDisk = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  expect(onDisk).toBe(tokensCss());
});
