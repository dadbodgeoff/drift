// Colour maths for token tests: WCAG 2.2 contrast, OKLab distance and
// colour-vision-deficiency simulation (Machado, Oliveira & Fernandes 2009,
// severity 1.0, applied in linear sRGB).

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as Rgb;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp = (x: number) => Math.min(1, Math.max(0, x));

export function linear(hex: string): Rgb {
  return hexToRgb(hex).map(toLinear) as Rgb;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function oklab([r, g, b]: Rgb): Rgb {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Euclidean distance in OKLab between two linear-sRGB colours. */
export function deltaE(a: Rgb, b: Rgb): number {
  const [p, q] = [oklab(a), oklab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

export function deltaEHex(a: string, b: string): number {
  return deltaE(linear(a), linear(b));
}

/** OKLCh hue angle in degrees. */
export function hue(hex: string): number {
  const [, a, b] = oklab(linear(hex));
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

export type Cvd = "protanopia" | "deuteranopia" | "tritanopia";

const MACHADO: Record<Cvd, number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** Simulated appearance (linear sRGB) of a colour for a viewer with `cvd`. */
export function simulate(hex: string, cvd: Cvd): Rgb {
  const c = linear(hex);
  const m = MACHADO[cvd];
  return m.map((row) => clamp(row[0] * c[0] + row[1] * c[1] + row[2] * c[2])) as Rgb;
}

/** Back to hex (for debugging and the gallery). */
export function rgbToHex(c: Rgb): string {
  return "#" + c.map((x) => Math.round(clamp(toGamma(x)) * 255).toString(16).padStart(2, "0")).join("");
}

/** Smallest pairwise OKLab distance within a palette, as seen with `cvd` (or normal vision). */
export function minPairwise(palette: string[], cvd?: Cvd): { d: number; pair: [string, string] } {
  let best = { d: Infinity, pair: ["", ""] as [string, string] };
  for (let i = 0; i < palette.length; i++)
    for (let j = i + 1; j < palette.length; j++) {
      const a = cvd ? simulate(palette[i], cvd) : linear(palette[i]);
      const b = cvd ? simulate(palette[j], cvd) : linear(palette[j]);
      const d = deltaE(a, b);
      if (d < best.d) best = { d, pair: [palette[i], palette[j]] };
    }
  return best;
}
