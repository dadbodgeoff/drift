// Shared hooks: windowing, focus management, persisted state, platform.
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Fixed-row-height windowing for long lists and tables. */
export function useVirtualRows(opts: { count: number; rowHeight: number; overscan?: number; scrollRef: RefObject<HTMLElement | null> }) {
  const { count, rowHeight, overscan = 8, scrollRef } = opts;
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 60) });
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const h = el.clientHeight || 600;
    const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
    const end = Math.min(count, Math.ceil((top + h) / rowHeight) + overscan);
    setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
  }, [count, rowHeight, overscan, scrollRef]);
  useLayoutEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, [measure, scrollRef]);
  const scrollToIndex = useCallback(
    (i: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const top = i * rowHeight;
      const headerOffset = 0;
      if (top < el.scrollTop + headerOffset) el.scrollTop = top - headerOffset;
      else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight;
    },
    [rowHeight, scrollRef],
  );
  return { ...range, total: count * rowHeight, scrollToIndex };
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Trap focus inside `ref` while `active`, and restore it to the previously focused element afterwards. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, initial?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = initial?.current ?? (el?.querySelector(FOCUSABLE) as HTMLElement | null) ?? el;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const a = items[0];
      const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [active, ref, initial]);
}

/** State persisted in localStorage (falls back to memory when storage is unavailable). */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s === null ? initial : (JSON.parse(s) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (x: T) => {
      setV(x);
      try {
        localStorage.setItem(key, JSON.stringify(x));
      } catch {
        // memory only
      }
    },
    [key],
  );
  return [v, set];
}

export function isMac(): boolean {
  const nav = typeof navigator === "undefined" ? null : navigator;
  const p = (nav as (Navigator & { userAgentData?: { platform?: string } }) | null)?.userAgentData?.platform ?? nav?.platform ?? "";
  return /mac|iphone|ipad/i.test(p);
}

/** `mod+k` -> `⌘K` on macOS, `Ctrl+K` elsewhere. */
export function shortcutLabel(combo: string, mac = isMac()): string {
  const parts = combo.split("+").map((p) => p.trim());
  const names: Record<string, [string, string]> = {
    mod: ["⌘", "Ctrl"],
    shift: ["⇧", "Shift"],
    alt: ["⌥", "Alt"],
    ctrl: ["⌃", "Ctrl"],
    enter: ["↩", "Enter"],
    esc: ["Esc", "Esc"],
    up: ["↑", "↑"],
    down: ["↓", "↓"],
  };
  const out = parts.map((p) => {
    const n = names[p.toLowerCase()];
    return n ? n[mac ? 0 : 1] : p.length === 1 && parts.length > 1 ? p.toUpperCase() : p;
  });
  return mac ? out.join("") : out.join("+");
}

/** Does a key event match `mod+k`, `g`, `shift+n`...? */
export function matchKey(e: KeyboardEvent | React.KeyboardEvent, combo: string, mac = isMac()): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop()!;
  const want = { mod: parts.includes("mod"), shift: parts.includes("shift"), alt: parts.includes("alt") };
  const mod = mac ? e.metaKey : e.ctrlKey;
  return e.key.toLowerCase() === key && mod === want.mod && e.shiftKey === want.shift && e.altKey === want.alt;
}

/** True when a key event comes from a text field (shortcuts should not fire). */
export function inTextField(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

export function useEvent<T extends (...args: never[]) => unknown>(fn: T): T {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback(((...args) => ref.current(...args)) as T, []);
}

export function cx(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}
