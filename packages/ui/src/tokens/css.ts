// Turn the tokens into CSS custom properties. Used by scripts/build-tokens.ts
// to write src/styles/tokens.css, and by a test that checks the file is current.
//
// Selectors: `[data-theme]` picks the scheme and contrast; `[data-direction]`
// picks the visual direction. The default direction also applies when no
// direction is set, so the stylesheet works without the attribute.
import {
  type Direction,
  type Theme,
  type ThemeName,
  breakpoints,
  defaultDirection,
  density,
  directionNames,
  directions,
  font,
  motion,
  radius,
  space,
  type,
  z,
} from "./index.ts";

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/\./g, "_");

function themeVars(t: Theme): string[] {
  const out: string[] = [`color-scheme: ${t.scheme};`];
  for (const [k, v] of Object.entries(t.color)) out.push(`--color-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(t.syntax)) out.push(`--syntax-${kebab(k)}: ${v};`);
  t.categorical.forEach((v, i) => out.push(`--data-cat-${i + 1}: ${v};`));
  t.sequential.forEach((v, i) => out.push(`--data-seq-${i + 1}: ${v};`));
  for (const [k, v] of Object.entries(t.shadow)) out.push(`--shadow-${k}: ${v};`);
  return out;
}

function directionVars(d: Direction): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(d.fonts)) out.push(`--font-${k}: ${v};`);
  for (const [k, v] of Object.entries(d.shape)) out.push(`--shape-${kebab(k)}: ${v};`);
  for (const [k, s] of Object.entries(d.type)) {
    if (!s) continue;
    if (s.size !== undefined) out.push(`--type-${k}-size: ${s.size}px;`);
    if (s.line !== undefined) out.push(`--type-${k}-line: ${s.line}px;`);
    if (s.weight !== undefined) out.push(`--type-${k}-weight: ${s.weight};`);
    if (s.tracking !== undefined) out.push(`--type-${k}-tracking: ${s.tracking};`);
  }
  return out;
}

export function tokensCss(): string {
  const root: string[] = [];
  for (const [k, v] of Object.entries(space)) root.push(`--space-${String(k).replace(".", "_")}: ${v}px;`);
  for (const [k, v] of Object.entries(radius)) root.push(`--radius-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(z)) root.push(`--z-${k}: ${v};`);
  for (const [k, v] of Object.entries(motion.duration)) root.push(`--duration-${k}: ${v}ms;`);
  for (const [k, v] of Object.entries(motion.easing)) root.push(`--ease-${k}: ${v};`);
  for (const [k, v] of Object.entries(breakpoints)) root.push(`--bp-${k}: ${v}px;`);
  root.push(`--font-sans: ${font.sans};`, `--font-mono: ${font.mono};`);
  for (const [k, s] of Object.entries(type)) {
    root.push(
      `--type-${k}-size: ${s.size}px;`,
      `--type-${k}-line: ${s.line}px;`,
      `--type-${k}-weight: ${s.weight};`,
      `--type-${k}-tracking: ${s.tracking};`,
    );
  }
  const block = (sel: string, lines: string[]) => `${sel} {\n${lines.map((l) => "  " + l).join("\n")}\n}\n`;
  const parts = [
    "/* Generated from src/tokens/index.ts by scripts/build-tokens.ts. Do not edit. */\n",
    block(":root", root),
  ];
  for (const [name, d] of Object.entries(density)) {
    parts.push(
      block(name === "comfortable" ? ":root,\n[data-density=\"comfortable\"]" : `[data-density="${name}"]`, [
        `--control-h: ${d.control}px;`,
        `--row-h: ${d.row}px;`,
        `--pad: ${d.pad}px;`,
        `--gap: ${d.gap}px;`,
        `--cell-x: ${d.cell}px;`,
      ]),
    );
  }
  // Direction-level tokens: fonts, type adjustments and shape.
  for (const dn of directionNames) {
    const sel = dn === defaultDirection ? `:root,\n[data-direction="${dn}"]` : `[data-direction="${dn}"]`;
    parts.push(block(sel, directionVars(directions[dn])));
  }
  // Colour themes per direction. The default direction's themes are unscoped,
  // so they apply when no direction is set; the others are scoped and win by
  // specificity.
  for (const dn of directionNames) {
    for (const name of Object.keys(directions[dn].themes) as ThemeName[]) {
      const t = directions[dn].themes[name];
      let sel: string;
      if (dn === defaultDirection) sel = name === "dark" ? `:root,\n[data-theme="dark"]` : `[data-theme="${name}"]`;
      else sel = name === "dark" ? `[data-direction="${dn}"],\n[data-direction="${dn}"][data-theme="dark"]` : `[data-direction="${dn}"][data-theme="${name}"]`;
      parts.push(block(sel, themeVars(t)));
    }
  }
  parts.push(
    "@media (prefers-reduced-motion: reduce) {\n  :root {\n" +
      Object.keys(motion.duration)
        .map((k) => `    --duration-${k}: 0ms;`)
        .join("\n") +
      "\n  }\n}\n",
  );
  return parts.join("\n");
}
