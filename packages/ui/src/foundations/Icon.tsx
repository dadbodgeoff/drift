// A small stroke icon set (16 px grid, 1.5 px stroke), drawn for Drift.
// Icons are decorative by default (aria-hidden); pass `label` to make one
// meaningful to assistive technology.
import type { SVGProps } from "react";

const P: Record<string, string> = {
  search: "M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5",
  x: "M4 4l8 8M12 4l-8 8",
  check: "M3 8.5l3.2 3L13 4.5",
  "chevron-right": "M6 3.5L10.5 8 6 12.5",
  "chevron-down": "M3.5 6L8 10.5 12.5 6",
  "chevron-left": "M10 3.5L5.5 8 10 12.5",
  "chevron-up": "M3.5 10L8 5.5 12.5 10",
  plus: "M8 3v10M3 8h10",
  minus: "M3 8h10",
  attention: "M8 1.75l6.25 11.5H1.75L8 1.75ZM8 6.5v3M8 11.5v.01",
  blocked: "M5.2 1.75h5.6l3.45 3.45v5.6l-3.45 3.45H5.2L1.75 10.8V5.2L5.2 1.75ZM5.5 5.5l5 5M10.5 5.5l-5 5",
  info: "M8 14.25A6.25 6.25 0 1 0 8 1.75a6.25 6.25 0 0 0 0 12.5ZM8 7.25v4M8 4.75v.01",
  ok: "M8 14.25A6.25 6.25 0 1 0 8 1.75a6.25 6.25 0 0 0 0 12.5ZM5.25 8.25l1.9 1.9 3.6-3.9",
  dot: "M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  home: "M2.25 7.25L8 2.5l5.75 4.75v6.25H9.75V10h-3.5v3.5h-4V7.25Z",
  review: "M2.5 4h7M2.5 8h5M2.5 12h4M10.5 10.5l1.5 1.5 3-3.5",
  check2: "M3 8.5l3.2 3L13 4.5",
  violation: "M2.25 3.25h11.5v9.5H2.25zM5 6.5l2 2-2 2M8.75 10.5h2.5",
  map: "M1.75 3.75l4-1.5 4.5 1.5 4-1.5v10l-4 1.5-4.5-1.5-4 1.5v-10ZM5.75 2.25v10M10.25 3.75v10",
  shield: "M8 1.75l5.25 2v4c0 3.25-2.25 5.5-5.25 6.5-3-1-5.25-3.25-5.25-6.5v-4L8 1.75Z",
  session: "M2.25 3.25h11.5v7.5H8.5l-3 2.5v-2.5H2.25v-7.5ZM5 6.25h6M5 8.25h3.5",
  flask: "M6.25 1.75h3.5M6.75 1.75v4.5L2.75 13a.8.8 0 0 0 .7 1.25h9.1a.8.8 0 0 0 .7-1.25l-4-6.75v-4.5M4.5 10h7",
  file: "M3.75 1.75h5.5l3 3v9.5h-8.5V1.75ZM9.25 1.75v3h3",
  folder: "M1.75 3.75h4.5l1.5 1.5h6.5v7.5H1.75v-9Z",
  code: "M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5",
  copy: "M5.25 5.25h7.5v8.5h-7.5zM3.25 10.75v-8.5h7",
  undo: "M5 3.5L2 6.5l3 3M2.5 6.5h7a3.75 3.75 0 0 1 0 7.5H6",
  refresh: "M13.25 4.75A5.75 5.75 0 0 0 2.5 6.25M2.75 11.25a5.75 5.75 0 0 0 10.75-1.5M13.5 1.75v3.25h-3.25M2.5 14.25V11h3.25",
  sun: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06",
  moon: "M13.5 9.75A5.75 5.75 0 0 1 6.25 2.5a5.75 5.75 0 1 0 7.25 7.25Z",
  contrast: "M8 14.25A6.25 6.25 0 1 0 8 1.75v12.5ZM8 14.25A6.25 6.25 0 0 1 8 1.75",
  keyboard: "M1.75 4.25h12.5v7.5H1.75zM4.25 6.75h.01M6.75 6.75h.01M9.25 6.75h.01M11.75 6.75h.01M4.75 9.25h6.5",
  filter: "M2 3h12l-4.75 5.5v4.75L6.75 14V8.5L2 3Z",
  settings: "M8 10.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4",
  logs: "M2.25 2.75h11.5v10.5H2.25zM4.75 5.75l2 2-2 2M8 9.75h3.25",
  eye: "M1.25 8S3.75 3.25 8 3.25 14.75 8 14.75 8 12.25 12.75 8 12.75 1.25 8 1.25 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  "eye-off": "M2 2l12 12M6.6 3.45A6.6 6.6 0 0 1 8 3.25C12.25 3.25 14.75 8 14.75 8a12 12 0 0 1-1.9 2.5M10.1 10.6A3.5 3.5 0 0 1 8 12.75C3.75 12.75 1.25 8 1.25 8a12 12 0 0 1 3.1-3.55",
  "arrow-right": "M2.5 8h11M9.5 4l4 4-4 4",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  layers: "M8 1.75l6.25 3.25L8 8.25 1.75 5 8 1.75ZM1.75 8L8 11.25 14.25 8M1.75 11L8 14.25 14.25 11",
  bolt: "M9 1.5L3 9h4.5L7 14.5 13 7H8.5L9 1.5Z",
  clock: "M8 14.25A6.25 6.25 0 1 0 8 1.75a6.25 6.25 0 0 0 0 12.5ZM8 4.5V8l2.5 1.5",
  user: "M8 7.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM2.75 14c.5-2.75 2.75-4.25 5.25-4.25S12.75 11.25 13.25 14",
  brain: "M6 2.5a2 2 0 0 0-2 2 2 2 0 0 0-1.25 3.5A2 2 0 0 0 4.5 11.5a2 2 0 0 0 3.5.75V3.5A1.75 1.75 0 0 0 6 2.5ZM10 2.5a2 2 0 0 1 2 2 2 2 0 0 1 1.25 3.5 2 2 0 0 1-1.75 3.5 2 2 0 0 1-3.5.75",
  tool: "M10.25 2a3.25 3.25 0 0 0-3 4.5L2.5 11.25a1.5 1.5 0 0 0 2.25 2.25l4.75-4.75A3.25 3.25 0 0 0 14 5.75l-2 2-1.75-.5-.5-1.75 2-2a3.3 3.3 0 0 0-1.5-1.5Z",
  edit: "M10.5 2.5l3 3L6 13H3v-3l7.5-7.5Z",
  export: "M8 10V1.75M5 4.75l3-3 3 3M2.75 9v4.25h10.5V9",
  play: "M4.5 2.75v10.5l8.5-5.25-8.5-5.25Z",
  repo: "M3.25 13.25V2.75c0-.55.45-1 1-1h8.5v10H4.25a1 1 0 0 0-1 1.5ZM6 4.5h4",
  next: "M4 3.5L8.5 8 4 12.5M9.5 3.5v9",
  prev: "M12 3.5L7.5 8 12 12.5M6.5 3.5v9",
  sidebar: "M1.75 2.75h12.5v10.5H1.75zM5.75 2.75v10.5",
  grid: "M2.25 2.25h4.5v4.5h-4.5zM9.25 2.25h4.5v4.5h-4.5zM2.25 9.25h4.5v4.5h-4.5zM9.25 9.25h4.5v4.5h-4.5z",
  external: "M9 2.25h4.75V7M13.5 2.5L7.5 8.5M11.5 9.5v4.25H2.25V4.5H6.5",
  "git-commit": "M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.25 8H5.5M10.5 8h4.25",
  sparkle: "M8 1.75l1.4 4.85 4.85 1.4-4.85 1.4L8 14.25l-1.4-4.85L1.75 8l4.85-1.4L8 1.75Z",
};

export type IconName = keyof typeof P;
export const iconNames = Object.keys(P) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  /** Accessible name; omit for decorative icons. */
  label?: string;
}

export function Icon({ name, size = 16, label, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={["dui-icon", className].filter(Boolean).join(" ")}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={P[name]} />
    </svg>
  );
}

/** Drift's mark: three offset contour arcs. */
export function DriftMark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" focusable="false" className="dui-mark">
      <rect width="20" height="20" rx="5" fill="var(--shape-mark-bg, var(--color-accent))" />
      <path d="M4.5 13.5c2.2-3.2 5.3-3.2 7.5 0M6.5 10c1.9-2.6 4.5-2.6 6.5 0M9 6.5c1.4-1.8 3.3-1.8 4.75 0" fill="none" stroke="var(--shape-mark-fg, var(--color-text-inverse))" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
