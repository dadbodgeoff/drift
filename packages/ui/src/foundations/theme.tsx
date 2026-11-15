// Theme and density: set as data attributes on <html> so tokens.css applies
// them without a reload. The choice is remembered per browser profile.
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type Density, type DirectionName, type ThemeName, defaultDirection, directionNames } from "../tokens/index";

export type ThemePreference = "system" | ThemeName;

interface ThemeState {
  preference: ThemePreference;
  theme: ThemeName;
  density: Density;
  highContrast: boolean;
  /** The visual direction (identity) in use. */
  direction: DirectionName;
  setPreference(p: ThemePreference): void;
  setDirection(d: DirectionName): void;
  setDensity(d: Density): void;
  setHighContrast(on: boolean): void;
}

const Ctx = createContext<ThemeState | null>(null);

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Storage can be unavailable (private windows); the choice then lasts for the session.
  }
}

function systemScheme(): "dark" | "light" {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function systemContrast(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-contrast: more)").matches;
}

export function ThemeProvider({ children, storageKey = "drift-ui", initial }: { children: ReactNode; storageKey?: string; initial?: Partial<{ preference: ThemePreference; density: Density; highContrast: boolean; direction: DirectionName }> }) {
  const [preference, setPref] = useState<ThemePreference>(() => initial?.preference ?? read(`${storageKey}:theme`, ["system", "dark", "light", "dark-hc", "light-hc"] as const, "dark"));
  const [density, setDens] = useState<Density>(() => initial?.density ?? read(`${storageKey}:density`, ["comfortable", "compact"] as const, "comfortable"));
  const [highContrast, setHc] = useState<boolean>(() => initial?.highContrast ?? (read(`${storageKey}:hc`, ["on", "off", "system"] as const, "system") === "on" || systemContrast()));
  const [direction, setDir] = useState<DirectionName>(() => initial?.direction ?? read(`${storageKey}:direction`, directionNames, defaultDirection));
  const [scheme, setScheme] = useState(systemScheme);

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia("(prefers-color-scheme: light)");
    const on = () => setScheme(m.matches ? "light" : "dark");
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  const base = preference === "system" ? scheme : preference.replace("-hc", "");
  const theme = (highContrast || preference.endsWith("-hc") ? `${base}-hc` : base) as ThemeName;

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = theme;
    el.dataset.density = density;
    el.dataset.direction = direction;
    el.style.colorScheme = theme.startsWith("light") ? "light" : "dark";
  }, [theme, density, direction]);

  const setPreference = useCallback(
    (p: ThemePreference) => {
      setPref(p);
      write(`${storageKey}:theme`, p);
    },
    [storageKey],
  );
  const setDensity = useCallback(
    (d: Density) => {
      setDens(d);
      write(`${storageKey}:density`, d);
    },
    [storageKey],
  );
  const setHighContrast = useCallback(
    (on: boolean) => {
      setHc(on);
      write(`${storageKey}:hc`, on ? "on" : "off");
    },
    [storageKey],
  );
  const setDirection = useCallback(
    (d: DirectionName) => {
      setDir(d);
      write(`${storageKey}:direction`, d);
    },
    [storageKey],
  );
  const value = useMemo(
    () => ({ preference, theme, density, highContrast, direction, setPreference, setDensity, setHighContrast, setDirection }),
    [preference, theme, density, highContrast, direction, setPreference, setDensity, setHighContrast, setDirection],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme needs a <ThemeProvider>");
  return v;
}

/** Read a token's computed value (e.g. for canvas and SVG charts). */
export function cssVar(name: string, el: Element = document.documentElement): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}
