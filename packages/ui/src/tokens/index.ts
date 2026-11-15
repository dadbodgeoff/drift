// Design tokens: the single source of truth. `scripts/build-tokens.ts` turns
// these into CSS custom properties (src/styles/tokens.css); a test fails when
// the two disagree, and another checks every text/background pair against
// WCAG 2.2 contrast.

export type ThemeName = "dark" | "light" | "dark-hc" | "light-hc";
export type Density = "comfortable" | "compact";

export interface ColorRoles {
  /** App background behind the shell. */
  bg: string;
  /** Main content surface. */
  surface: string;
  /** Wells: code, inputs, table headers. */
  sunken: string;
  /** Cards and panels on the surface. */
  raised: string;
  /** Popovers, menus, dialogs, drawers. */
  overlay: string;
  hover: string;
  pressed: string;
  selected: string;
  /** Decorative hairlines between regions. */
  border: string;
  /** Boundaries of controls (inputs, checkboxes): at least 3:1 against surfaces. */
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  /** Text on accent and on strong status fills. */
  textInverse: string;
  accent: string;
  accentHover: string;
  accentSubtle: string;
  accentText: string;
  focus: string;
  success: string;
  successSubtle: string;
  warning: string;
  warningSubtle: string;
  danger: string;
  dangerSubtle: string;
  info: string;
  infoSubtle: string;
  /** Diff and code. */
  diffAdd: string;
  diffAddText: string;
  diffDel: string;
  diffDelText: string;
  lineFocus: string;
  scrim: string;
}

export interface SyntaxRoles {
  comment: string;
  string: string;
  number: string;
  keyword: string;
  type: string;
  function: string;
  decorator: string;
  tag: string;
  punct: string;
  plain: string;
}

export interface Theme {
  name: ThemeName;
  scheme: "dark" | "light";
  /** Minimum contrast every text role must reach on every surface. */
  textContrast: number;
  color: ColorRoles;
  syntax: SyntaxRoles;
  /** Categorical data colours, in order of use. */
  categorical: string[];
  /** Sequential ramp for magnitude, low to high. */
  sequential: string[];
  shadow: { sm: string; md: string; lg: string };
}




/** 4 px base unit. Keys are steps; `space[4]` is 16 px. */
export const space = { 0: 0, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;

export const radius = { xs: 3, sm: 4, md: 6, lg: 8, xl: 12, pill: 999 } as const;

export const z = { base: 0, sticky: 10, panel: 20, drawer: 30, overlay: 40, dialog: 50, palette: 60, toast: 70, tooltip: 80 } as const;

export const motion = {
  duration: { instant: 80, fast: 140, base: 220, slow: 320 },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    emphasized: "cubic-bezier(0.3, 0, 0, 1)",
    exit: "cubic-bezier(0.4, 0, 1, 1)",
  },
} as const;

export const breakpoints = { sm: 640, md: 960, lg: 1280, xl: 1600 } as const;

export const density: Record<Density, { control: number; row: number; pad: number; gap: number; cell: number }> = {
  comfortable: { control: 30, row: 32, pad: 24, gap: 16, cell: 10 },
  compact: { control: 26, row: 26, pad: 16, gap: 12, cell: 8 },
};

export const font = {
  sans: "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
} as const;

export interface TypeStyle {
  size: number;
  line: number;
  weight: number;
  tracking: string;
  family: "sans" | "mono";
  transform?: "uppercase";
}

export const type: Record<string, TypeStyle> = {
  display: { size: 30, line: 36, weight: 600, tracking: "-0.02em", family: "sans" },
  h1: { size: 22, line: 28, weight: 600, tracking: "-0.015em", family: "sans" },
  h2: { size: 17, line: 24, weight: 600, tracking: "-0.01em", family: "sans" },
  h3: { size: 15, line: 22, weight: 600, tracking: "-0.005em", family: "sans" },
  h4: { size: 13, line: 20, weight: 600, tracking: "0", family: "sans" },
  title: { size: 13, line: 20, weight: 500, tracking: "0", family: "sans" },
  body: { size: 13, line: 20, weight: 400, tracking: "0", family: "sans" },
  "body-sm": { size: 12, line: 18, weight: 400, tracking: "0", family: "sans" },
  caption: { size: 11, line: 16, weight: 400, tracking: "0.005em", family: "sans" },
  overline: { size: 11, line: 16, weight: 600, tracking: "0.06em", family: "sans", transform: "uppercase" },
  code: { size: 12, line: 18, weight: 400, tracking: "0", family: "mono" },
  /** Readouts: counts, ratios and bounds, in tabular monospace. */
  "readout-xl": { size: 44, line: 48, weight: 500, tracking: "-0.04em", family: "mono" },
  "readout-lg": { size: 32, line: 36, weight: 500, tracking: "-0.03em", family: "mono" },
  "readout-md": { size: 22, line: 28, weight: 500, tracking: "-0.02em", family: "mono" },
  "readout-sm": { size: 15, line: 20, weight: 500, tracking: "-0.01em", family: "mono" },
};

// ---------------------------------------------------------------------------
// Visual directions. A direction is a complete identity: four themes (dark,
// light and their high-contrast variants), its typefaces, type adjustments and
// shape tokens (how surfaces, borders and labels are drawn). Chart is Drift's
// identity; Cyanotype is an optional theme. Every theme of every direction
// passes the same tests (tests/tokens.test.ts).
// ---------------------------------------------------------------------------

export type DirectionName = "chart" | "cyanotype";

/** Non-colour tokens that carry a direction's surface and border philosophy. */
export interface DirectionShape {
  /** Background of cards and panels (a colour role or `transparent`). */
  cardBg: string;
  /** Full border of cards and panels (`0` for none). */
  cardBorder: string;
  cardRadius: string;
  cardShadow: string;
  /** The rule under a panel heading (`0` for none). */
  cardHeadRule: string;
  /** The rule above a section when cards have no border (`0` for none). */
  sectionRule: string;
  controlRadius: string;
  badgeRadius: string;
  /** Overline labels: tracking, width and case. */
  labelTracking: string;
  labelStretch: string;
  labelWeight: string;
  /** Display and headings: width and weight. */
  displayStretch: string;
  displayWeight: string;
  displayStyle: string;
  /** The mark: tile and stroke. */
  markBg: string;
  markFg: string;
}

export interface DirectionFonts {
  sans: string;
  mono: string;
  /** Headings and hero numbers. */
  display: string;
  /** Instrument readouts: counts, ratios, bounds. */
  readout: string;
  /** Overline labels and legends. */
  label: string;
}

export interface Direction {
  name: DirectionName;
  label: string;
  /** One sentence: the point of view. */
  thesis: string;
  fonts: DirectionFonts;
  /** Size and weight changes to the type scale. */
  type: Partial<Record<keyof typeof type, Partial<Pick<TypeStyle, "size" | "line" | "weight" | "tracking">>>>;
  shape: DirectionShape;
  themes: Record<ThemeName, Theme>;
}

function variant(base: Theme, name: ThemeName, textContrast: number, color: Partial<ColorRoles>, syntax: Partial<SyntaxRoles> = {}): Theme {
  return { ...base, name, textContrast, color: { ...base.color, ...color }, syntax: { ...base.syntax, ...syntax } };
}

// ---- Chart: a hydrographic survey chart. Paper, ink and a magenta overprint.
const chartLight: Theme = {
  name: "light",
  scheme: "light",
  textContrast: 4.5,
  color: {
    bg: "#ebe4d4",
    surface: "#f7f3ea",
    sunken: "#f0ebdf",
    raised: "#fbf8f1",
    overlay: "#fffdf8",
    hover: "#efe8da",
    pressed: "#e5dccb",
    selected: "#f5e1ec",
    border: "#ddd3c0",
    borderStrong: "#857a66",
    textPrimary: "#1d1a15",
    textSecondary: "#463f34",
    textMuted: "#665d4e",
    textDisabled: "#a59a86",
    textInverse: "#ffffff",
    accent: "#b0207a",
    accentHover: "#951a67",
    accentSubtle: "#f5e1ec",
    accentText: "#951a67",
    focus: "#b0207a",
    success: "#286c3b",
    successSubtle: "#e3ecd9",
    warning: "#835000",
    warningSubtle: "#f5e7c9",
    danger: "#bf2111",
    dangerSubtle: "#f7e0d8",
    info: "#1f5f93",
    infoSubtle: "#e0e9f0",
    diffAdd: "#e3eed9",
    diffAddText: "#23502b",
    diffDel: "#f7e0d9",
    diffDelText: "#7a2414",
    lineFocus: "#f4e6ec",
    scrim: "rgba(29, 26, 21, 0.34)",
  },
  syntax: { comment: "#6b6252", string: "#3b6a22", number: "#8a4a00", keyword: "#8a2363", type: "#1d5a8a", function: "#0b625a", decorator: "#8a4a00", tag: "#a3351e", punct: "#4e463a", plain: "#1d1a15" },
  categorical: ["#1c719a", "#ad8b15", "#5a9b80", "#8b363a", "#593979", "#806f00", "#0f194f", "#502209"],
  sequential: ["#e4ecef", "#c4d8e1", "#9dbdcf", "#719cb9", "#46799f", "#22547d"],
  shadow: {
    sm: "0 1px 0 rgba(60, 48, 30, 0.06)",
    md: "0 1px 0 rgba(60, 48, 30, 0.06), 0 6px 16px rgba(60, 48, 30, 0.10)",
    lg: "0 2px 6px rgba(60, 48, 30, 0.10), 0 22px 48px rgba(60, 48, 30, 0.18)",
  },
};

const chartDark: Theme = {
  name: "dark",
  scheme: "dark",
  textContrast: 4.5,
  color: {
    bg: "#130d07",
    surface: "#1a120b",
    sunken: "#100b06",
    raised: "#231a11",
    overlay: "#2b2116",
    hover: "#2d2216",
    pressed: "#362a1e",
    selected: "#371c2c",
    border: "#403325",
    borderStrong: "#867b69",
    textPrimary: "#efe8d9",
    textSecondary: "#c9bfab",
    textMuted: "#a69b86",
    textDisabled: "#5f574a",
    textInverse: "#1b0c15",
    accent: "#ec7cc4",
    accentHover: "#f39dd2",
    accentSubtle: "#371c2c",
    accentText: "#f3a2d4",
    focus: "#f3a2d4",
    success: "#82c98e",
    successSubtle: "#17251a",
    warning: "#e6b352",
    warningSubtle: "#2a2110",
    danger: "#f37d61",
    dangerSubtle: "#33190f",
    info: "#7cb4e4",
    infoSubtle: "#132231",
    diffAdd: "#15241a",
    diffAddText: "#a9dcb2",
    diffDel: "#2e1813",
    diffDelText: "#f6b8a6",
    lineFocus: "#2e1624",
    scrim: "rgba(5, 4, 3, 0.62)",
  },
  syntax: { comment: "#978d7a", string: "#b5d49a", number: "#e9b872", keyword: "#eda0cf", type: "#8cc3e8", function: "#86d1bf", decorator: "#e9b872", tag: "#f2a08a", punct: "#a59b88", plain: "#ebe4d6" },
  categorical: ["#93c7e8", "#e3bc6d", "#48a483", "#e56d0c", "#b083de", "#f3f493", "#4c6ea2", "#a7fafa"],
  sequential: ["#0f2f3d", "#00445e", "#005c7b", "#14799c", "#489ebf", "#87c9e2"],
  shadow: {
    sm: "0 1px 0 rgba(0, 0, 0, 0.35)",
    md: "0 1px 0 rgba(255, 240, 220, 0.03) inset, 0 6px 18px rgba(0, 0, 0, 0.4)",
    lg: "0 1px 0 rgba(255, 240, 220, 0.04) inset, 0 18px 48px rgba(0, 0, 0, 0.55)",
  },
};

const chart: Direction = {
  name: "chart",
  label: "Chart",
  thesis: "A hydrographic survey of the codebase: paper and ink, depth tints for magnitude, and one magenta overprint for what you are doing.",
  fonts: {
    sans: font.sans,
    mono: font.mono,
    display: "'Source Serif 4 Variable', 'Source Serif 4', Georgia, 'Times New Roman', serif",
    // Numbers read like instrument output: monospace, tabular.
    readout: font.mono,
    label: font.sans,
  },
  type: {
    display: { size: 40, line: 44, weight: 500, tracking: "-0.02em" },
    h1: { size: 26, line: 32, weight: 500, tracking: "-0.01em" },
    h2: { size: 21, line: 28, weight: 500, tracking: "-0.005em" },
  },
  shape: {
    cardBg: "transparent",
    cardBorder: "0",
    cardRadius: "0",
    cardShadow: "none",
    cardHeadRule: "0",
    sectionRule: "1px solid var(--color-border-strong)",
    controlRadius: "3px",
    badgeRadius: "2px",
    labelTracking: "0.09em",
    labelStretch: "100%",
    labelWeight: "600",
    displayStretch: "100%",
    displayWeight: "500",
    displayStyle: "normal",
    markBg: "transparent",
    markFg: "var(--color-accent)",
  },
  themes: {
    dark: chartDark,
    light: chartLight,
    "dark-hc": variant(chartDark, "dark-hc", 7, {
      bg: "#070605", surface: "#0b0a08", sunken: "#050403", raised: "#12100c", overlay: "#18150f", hover: "#221e17", pressed: "#2c271f", selected: "#3a2232",
      border: "#6e6455", borderStrong: "#b3a892", textPrimary: "#ffffff", textSecondary: "#efe8da", textMuted: "#d8cfbd", textDisabled: "#857b6a",
      accent: "#f5b3f0", accentHover: "#fbcdf6", accentSubtle: "#3a2232", accentText: "#f8c4f3", focus: "#ffe08a",
      success: "#97ebb1", warning: "#ffd27a", danger: "#fb9e87", info: "#9bd5fb", diffAddText: "#cbf2d2", diffDelText: "#ffd3c4",
    }, { comment: "#cfc5b2", punct: "#ddd5c6", plain: "#ffffff" }),
    "light-hc": variant(chartLight, "light-hc", 7, {
      bg: "#fbf8f1", surface: "#fffdf8", sunken: "#f3eee3", raised: "#ffffff", overlay: "#ffffff", selected: "#f9edf3",
      border: "#7d725f", borderStrong: "#3d362b", textPrimary: "#000000", textSecondary: "#1d1a15", textMuted: "#2f2a22", textDisabled: "#7d725f",
      accent: "#891a67", accentHover: "#701150", accentSubtle: "#f9edf3", accentText: "#701150", focus: "#0040c0",
      success: "#1a5327", warning: "#502900", danger: "#912103", info: "#164873",
      successSubtle: "#eef5e8", warningSubtle: "#fbf2df", dangerSubtle: "#fcefe9", infoSubtle: "#edf3f8", diffAddText: "#123a1a", diffDelText: "#5a1a0d",
    }, { comment: "#3b352c", punct: "#2c2720", plain: "#000000" }),
  },
};

// ---- Cyanotype: a blueprint of the codebase. Prussian blue, white linework, pink markup.
const cyanotypeDark: Theme = {
  name: "dark",
  scheme: "dark",
  textContrast: 4.5,
  color: {
    bg: "#0d2a50",
    surface: "#12315c",
    sunken: "#0c264a",
    raised: "#163868",
    overlay: "#1b4175",
    hover: "#1c4477",
    pressed: "#224d84",
    selected: "#3a3a78",
    border: "#2b5488",
    borderStrong: "#9fb6d8",
    textPrimary: "#f5f8fc",
    textSecondary: "#cfdcef",
    textMuted: "#adc0dd",
    textDisabled: "#6b87b0",
    textInverse: "#2a0a1f",
    accent: "#ff9ccf",
    accentHover: "#ffb8dc",
    accentSubtle: "#3a3a78",
    accentText: "#ffb8dc",
    focus: "#ffd6ec",
    success: "#7fe0a6",
    successSubtle: "#154453",
    warning: "#ffd166",
    warningSubtle: "#33415a",
    danger: "#ff9466",
    dangerSubtle: "#3a2f52",
    info: "#9fd8ff",
    infoSubtle: "#1a4a7e",
    diffAdd: "#15434f",
    diffAddText: "#b6f2cc",
    diffDel: "#3a2f52",
    diffDelText: "#ffc9b5",
    lineFocus: "#233f78",
    scrim: "rgba(5, 16, 34, 0.6)",
  },
  syntax: { comment: "#a3b8d8", string: "#b6f2a0", number: "#ffd27a", keyword: "#ffb8dc", type: "#9fe0ff", function: "#a8f0e0", decorator: "#ffd27a", tag: "#ffab8f", punct: "#bccbe2", plain: "#f5f8fc" },
  categorical: ["#55deff", "#e7b214", "#7cc89e", "#e0740b", "#b49cf9", "#f9db1c", "#ffeff7", "#b6f39b"],
  sequential: ["#1e4577", "#2f5b91", "#4a76aa", "#7097c4", "#a3bfdf", "#e3edf8"],
  shadow: {
    sm: "0 0 0 rgba(0, 0, 0, 0)",
    md: "0 8px 24px rgba(3, 12, 28, 0.45)",
    lg: "0 22px 56px rgba(3, 12, 28, 0.6)",
  },
};

const cyanotypeLight: Theme = {
  name: "light",
  scheme: "light",
  textContrast: 4.5,
  color: {
    bg: "#d7e4f4",
    surface: "#f5f8fc",
    sunken: "#ecf1f8",
    raised: "#ffffff",
    overlay: "#ffffff",
    hover: "#e4edf8",
    pressed: "#d3dff0",
    selected: "#fae9f2",
    border: "#b5c9e6",
    borderStrong: "#5b78a3",
    textPrimary: "#0b2550",
    textSecondary: "#28467a",
    textMuted: "#46628f",
    textDisabled: "#9aaecb",
    textInverse: "#ffffff",
    accent: "#b51d6f",
    accentHover: "#97185d",
    accentSubtle: "#fae9f2",
    accentText: "#97185d",
    focus: "#b51d6f",
    success: "#17733f",
    successSubtle: "#e0f1e7",
    warning: "#845100",
    warningSubtle: "#f8ecd2",
    danger: "#c62f00",
    dangerSubtle: "#fbe5dc",
    info: "#10678b",
    infoSubtle: "#def0f6",
    diffAdd: "#e0f1e7",
    diffAddText: "#0f4a29",
    diffDel: "#fbe5dc",
    diffDelText: "#7a240b",
    lineFocus: "#eef0fa",
    scrim: "rgba(11, 37, 80, 0.32)",
  },
  syntax: { comment: "#4f6a94", string: "#1f6b34", number: "#8a4f00", keyword: "#9a1d63", type: "#0d4f9e", function: "#0a6660", decorator: "#8a4f00", tag: "#a8361a", punct: "#3b5480", plain: "#0b2550" },
  categorical: ["#3352c7", "#9f610e", "#16998b", "#8c3019", "#633b7f", "#a29522", "#0f0543", "#3f272f"],
  sequential: ["#e3ecf7", "#bfd2ec", "#90b1dc", "#5f8bc6", "#3463a8", "#0f3a7a"],
  shadow: {
    sm: "0 1px 0 rgba(11, 37, 80, 0.06)",
    md: "0 1px 2px rgba(11, 37, 80, 0.08), 0 8px 20px rgba(11, 37, 80, 0.10)",
    lg: "0 2px 6px rgba(11, 37, 80, 0.10), 0 24px 56px rgba(11, 37, 80, 0.20)",
  },
};

const cyanotype: Direction = {
  name: "cyanotype",
  label: "Cyanotype",
  thesis: "A blueprint of the codebase: Prussian blue, white linework drawn to scale, dimension lines for evidence, and pink markup where a person acts.",
  fonts: {
    sans: font.sans,
    mono: "'IBM Plex Mono', 'JetBrains Mono Variable', ui-monospace, monospace",
    display: "'Archivo Variable', Archivo, 'Helvetica Neue', Arial, sans-serif",
    readout: "'Archivo Variable', Archivo, 'Helvetica Neue', Arial, sans-serif",
    label: "'Archivo Variable', Archivo, 'Helvetica Neue', Arial, sans-serif",
  },
  type: {
    display: { size: 36, line: 40, weight: 700, tracking: "-0.01em" },
    h1: { size: 22, line: 28, weight: 700, tracking: "0" },
    h2: { size: 18, line: 24, weight: 700, tracking: "0" },
    overline: { size: 10.5, line: 14, weight: 700, tracking: "0.14em" },
  },
  shape: {
    cardBg: "color-mix(in srgb, var(--color-raised) 55%, transparent)",
    cardBorder: "1px solid var(--color-border)",
    cardRadius: "0",
    cardShadow: "none",
    cardHeadRule: "1px solid var(--color-border)",
    sectionRule: "0",
    controlRadius: "2px",
    badgeRadius: "1px",
    labelTracking: "0.14em",
    labelStretch: "125%",
    labelWeight: "700",
    displayStretch: "112%",
    displayWeight: "700",
    displayStyle: "normal",
    markBg: "transparent",
    markFg: "var(--color-text-primary)",
  },
  themes: {
    dark: cyanotypeDark,
    light: cyanotypeLight,
    "dark-hc": variant(cyanotypeDark, "dark-hc", 7, {
      bg: "#071c38", surface: "#0a2142", sunken: "#061a35", raised: "#0d274d", overlay: "#112d57", hover: "#183766", pressed: "#1f4174", selected: "#29255a",
      border: "#7f9cc6", borderStrong: "#c5d4ea", textPrimary: "#ffffff", textSecondary: "#eef3fa", textMuted: "#d6e1f1", textDisabled: "#7f9cc6",
      accent: "#ffb1ed", accentHover: "#ffd6ec", accentSubtle: "#29255a", accentText: "#ffcfe8", focus: "#fff07a",
      success: "#88f5b9", warning: "#ffe188", danger: "#fdab86", info: "#c7e7ff",
      successSubtle: "#0f3442", warningSubtle: "#26314a", dangerSubtle: "#2a2244", infoSubtle: "#0f3361", diffAdd: "#0f3442", diffDel: "#2a2244", diffAddText: "#d0fae0", diffDelText: "#ffdccf", lineFocus: "#1c3366",
    }, { comment: "#d0dcee", punct: "#dce6f4", plain: "#ffffff" }),
    "light-hc": variant(cyanotypeLight, "light-hc", 7, {
      bg: "#ffffff", surface: "#ffffff", sunken: "#eef3f9", raised: "#ffffff", overlay: "#ffffff", selected: "#faedf4",
      border: "#4d6a96", borderStrong: "#1d3a68", textPrimary: "#001634", textSecondary: "#0b2550", textMuted: "#1d3a68", textDisabled: "#6680a8",
      accent: "#870b65", accentHover: "#730f47", accentSubtle: "#faedf4", accentText: "#730f47", focus: "#0040c0",
      success: "#035a22", warning: "#573906", danger: "#971d0b", info: "#064c67",
      successSubtle: "#eef8f2", warningSubtle: "#fdf6e6", dangerSubtle: "#fdf0ee", infoSubtle: "#ecf6fa", diffAddText: "#0b3a20", diffDelText: "#5a1a06",
    }, { comment: "#1d3a68", punct: "#162f58", plain: "#001634" }),
  },
};

export const directions: Record<DirectionName, Direction> = { chart, cyanotype };
export const directionNames = Object.keys(directions) as DirectionName[];
/** The direction used when none is chosen. */
export const defaultDirection: DirectionName = "chart";
/** The default direction's themes. */
export const themes: Record<ThemeName, Theme> = chart.themes;
