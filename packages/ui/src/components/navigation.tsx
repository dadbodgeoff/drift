// Tabs (WAI-ARIA APG tabs, automatic activation, roving tabindex) and a
// segmented control (a radio group that looks like buttons).
import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";
import { Icon, type IconName } from "../foundations/Icon";
import { cx } from "../foundations/hooks";

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
  icon?: IconName;
  disabled?: boolean;
}

function roving<T extends string>(e: KeyboardEvent, items: TabItem<T>[], current: T, onChange: (v: T) => void, refs: (HTMLElement | null)[], vertical = false) {
  const enabled = items.filter((i) => !i.disabled);
  const idx = enabled.findIndex((i) => i.value === current);
  const next = vertical ? "ArrowDown" : "ArrowRight";
  const prev = vertical ? "ArrowUp" : "ArrowLeft";
  let to = -1;
  if (e.key === next) to = (idx + 1) % enabled.length;
  else if (e.key === prev) to = (idx - 1 + enabled.length) % enabled.length;
  else if (e.key === "Home") to = 0;
  else if (e.key === "End") to = enabled.length - 1;
  if (to < 0) return;
  e.preventDefault();
  const v = enabled[to].value;
  onChange(v);
  refs[items.findIndex((i) => i.value === v)]?.focus();
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onValueChange(v: T): void;
  label: string;
  /** Id prefix linking tabs to panels (`${idBase}-panel-${value}`). */
  idBase?: string;
  size?: "sm" | "md";
}

export function Tabs<T extends string>({ items, value, onValueChange, label, idBase, size = "md" }: TabsProps<T>) {
  const auto = useId();
  const base = idBase ?? auto;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label={label} className={cx("dui-tabs", `dui-tabs--${size}`)} onKeyDown={(e) => roving(e, items, value, onValueChange, refs.current)}>
      {items.map((t, i) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${base}-tab-${t.value}`}
            aria-selected={selected}
            aria-controls={`${base}-panel-${t.value}`}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            className={cx("dui-tab", selected && "is-selected")}
            onClick={() => onValueChange(t.value)}
          >
            {t.icon && <Icon name={t.icon} size={14} />}
            <span>{t.label}</span>
            {t.count !== undefined && <span className="dui-tab__count">{t.count.toLocaleString()}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idBase, value, children, className }: { idBase: string; value: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${value}`} aria-labelledby={`${idBase}-tab-${value}`} tabIndex={0} className={cx("dui-tabpanel", className)}>
      {children}
    </div>
  );
}

export interface SegmentedProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onValueChange(v: T): void;
  label: string;
  size?: "sm" | "md";
}

export function SegmentedControl<T extends string>({ items, value, onValueChange, label, size = "md" }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="radiogroup" aria-label={label} className={cx("dui-segmented", `dui-segmented--${size}`)} onKeyDown={(e) => roving(e, items, value, onValueChange, refs.current)}>
      {items.map((t, i) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={t.disabled}
            className={cx("dui-segment", on && "is-selected")}
            onClick={() => onValueChange(t.value)}
          >
            {t.icon && <Icon name={t.icon} size={14} />}
            {t.label}
            {t.count !== undefined && <span className="dui-tab__count">{t.count.toLocaleString()}</span>}
          </button>
        );
      })}
    </div>
  );
}
