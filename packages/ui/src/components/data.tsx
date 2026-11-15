// Data components: a virtualized DataTable, a virtualized Tree, resizable
// split panes and timeline primitives.
import { type CSSProperties, type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../foundations/Icon";
import { cx, usePersistentState, useVirtualRows } from "../foundations/hooks";

// ---------- DataTable ----------

export interface Column<T> {
  id: string;
  header: ReactNode;
  /** Initial width in px; the last column takes the remaining space when `flex`. */
  width?: number;
  minWidth?: number;
  flex?: boolean;
  align?: "left" | "right" | "center";
  mono?: boolean;
  sortValue?: (row: T) => string | number;
  render: (row: T) => ReactNode;
  /** Plain text for the cell's title and for copy. */
  text?: (row: T) => string;
}

export interface SortState {
  column: string;
  dir: "asc" | "desc";
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  label: string;
  rowHeight?: number;
  /** Height of the scroll area; defaults to filling the parent. */
  height?: number | string;
  sort?: SortState | null;
  onSortChange?: (s: SortState | null) => void;
  defaultSort?: SortState | null;
  selection?: { mode: "single" | "multi"; selected: Set<string>; onChange(next: Set<string>): void };
  activeKey?: string | null;
  onActiveChange?: (key: string | null, row: T | null) => void;
  onRowActivate?: (row: T) => void;
  rowTone?: (row: T) => "danger" | "warning" | "muted" | null;
  empty?: ReactNode;
  /** Persist column widths under this key. */
  storageKey?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  label,
  rowHeight = 32,
  height = "100%",
  sort: sortProp,
  onSortChange,
  defaultSort = null,
  selection,
  activeKey: activeProp,
  onActiveChange,
  onRowActivate,
  rowTone,
  empty,
  storageKey,
}: DataTableProps<T>) {
  const id = useId();
  const scroll = useRef<HTMLDivElement | null>(null);
  const [sortLocal, setSortLocal] = useState<SortState | null>(defaultSort);
  const sort = sortProp !== undefined ? sortProp : sortLocal;
  const setSort = (s: SortState | null) => (onSortChange ? onSortChange(s) : setSortLocal(s));
  const [widths, setWidths] = usePersistentState<Record<string, number>>(storageKey ? `dui-table:${storageKey}` : `dui-table:${id}`, {});
  const [activeLocal, setActiveLocal] = useState<string | null>(null);
  const activeKey = activeProp !== undefined ? activeProp : activeLocal;

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.column);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    const out = [...rows].sort((a, b) => {
      const x = sv(a);
      const y = sv(b);
      return typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    });
    return sort.dir === "desc" ? out.reverse() : out;
  }, [rows, columns, sort]);

  const v = useVirtualRows({ count: sorted.length, rowHeight, scrollRef: scroll });
  const index = useMemo(() => new Map(sorted.map((r, i) => [rowKey(r), i])), [sorted, rowKey]);
  const activeIndex = activeKey ? (index.get(activeKey) ?? -1) : -1;

  const setActive = useCallback(
    (i: number) => {
      const r = sorted[i];
      if (!r) return;
      const k = rowKey(r);
      setActiveLocal(k);
      onActiveChange?.(k, r);
      v.scrollToIndex(i);
    },
    [sorted, rowKey, onActiveChange, v],
  );

  const template = columns.map((c) => (c.flex ? `minmax(${c.minWidth ?? 120}px, 1fr)` : `${widths[c.id] ?? c.width ?? 140}px`)).join(" ");

  const toggle = (k: string) => {
    if (!selection) return;
    const next = new Set(selection.mode === "single" ? [] : selection.selected);
    if (selection.selected.has(k)) next.delete(k);
    else next.add(k);
    selection.onChange(next);
  };

  const onKey = (e: KeyboardEvent) => {
    const page = Math.max(1, Math.floor((scroll.current?.clientHeight ?? 320) / rowHeight) - 1);
    const i = activeIndex < 0 ? -1 : activeIndex;
    let to: number | null = null;
    if (e.key === "ArrowDown") to = Math.min(sorted.length - 1, i + 1);
    else if (e.key === "ArrowUp") to = Math.max(0, i - 1);
    else if (e.key === "PageDown") to = Math.min(sorted.length - 1, i + page);
    else if (e.key === "PageUp") to = Math.max(0, i - page);
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = sorted.length - 1;
    else if (e.key === " " && activeKey) {
      e.preventDefault();
      toggle(activeKey);
      return;
    } else if (e.key === "Enter" && i >= 0) {
      e.preventDefault();
      onRowActivate?.(sorted[i]);
      return;
    }
    if (to !== null) {
      e.preventDefault();
      setActive(to);
    }
  };

  const startResize = (col: Column<T>, startX: number) => {
    const startW = widths[col.id] ?? col.width ?? 140;
    const move = (ev: PointerEvent) => setWidths({ ...widths, [col.id]: Math.max(col.minWidth ?? 60, startW + ev.clientX - startX) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const rowsShown = [];
  for (let i = v.start; i < Math.min(v.end, sorted.length); i++) {
    const r = sorted[i];
    const k = rowKey(r);
    const tone = rowTone?.(r);
    rowsShown.push(
      <div
        key={k}
        id={`${id}-r${i}`}
        role="row"
        aria-rowindex={i + 2}
        aria-selected={selection ? selection.selected.has(k) : k === activeKey}
        className={cx("dui-table__row", k === activeKey && "is-active", selection?.selected.has(k) && "is-selected", tone && `is-${tone}`)}
        style={{ top: i * rowHeight, height: rowHeight, gridTemplateColumns: template }}
        onClick={() => {
          setActive(i);
          if (selection?.mode === "single") toggle(k);
        }}
        onDoubleClick={() => onRowActivate?.(r)}
      >
        {columns.map((c) => (
          <div key={c.id} role="gridcell" className={cx("dui-table__cell", c.mono && "dui-mono", c.align && `is-${c.align}`)} title={c.text?.(r)}>
            {c.render(r)}
          </div>
        ))}
      </div>,
    );
  }

  return (
    <div className="dui-table" style={{ height }}>
      <div
        ref={scroll}
        className="dui-table__scroll"
        role="grid"
        aria-label={label}
        aria-rowcount={sorted.length + 1}
        aria-multiselectable={selection?.mode === "multi" || undefined}
        tabIndex={0}
        aria-activedescendant={activeIndex >= 0 ? `${id}-r${activeIndex}` : undefined}
        onKeyDown={onKey}
        onFocus={() => {
          if (activeIndex < 0 && sorted.length) setActive(0);
        }}
      >
        <div role="row" aria-rowindex={1} className="dui-table__head" style={{ gridTemplateColumns: template }}>
          {columns.map((c) => {
            const sorted_ = sort?.column === c.id ? sort.dir : null;
            return (
              <div key={c.id} role="columnheader" aria-sort={sorted_ === "asc" ? "ascending" : sorted_ === "desc" ? "descending" : c.sortValue ? "none" : undefined} className={cx("dui-table__th", c.align && `is-${c.align}`)}>
                {c.sortValue ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    className="dui-table__sort"
                    onClick={() => setSort(sorted_ === "asc" ? { column: c.id, dir: "desc" } : sorted_ === "desc" ? null : { column: c.id, dir: "asc" })}
                  >
                    {c.header}
                    <Icon name={sorted_ === "desc" ? "chevron-down" : "chevron-up"} size={11} className={cx("dui-table__sorticon", sorted_ && "is-on")} />
                  </button>
                ) : (
                  <span>{c.header}</span>
                )}
                {!c.flex && (
                  <span
                    className="dui-table__resize"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${typeof c.header === "string" ? c.header : c.id}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      startResize(c, e.clientX);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
        {sorted.length === 0 ? (
          <div className="dui-table__empty">{empty ?? "Nothing to show"}</div>
        ) : (
          <div className="dui-table__body" style={{ height: v.total }} role="rowgroup">
            {rowsShown}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Tree ----------

export interface TreeNode {
  id: string;
  label: ReactNode;
  /** Text used for type-ahead and titles. */
  text?: string;
  icon?: IconName;
  detail?: ReactNode;
  badge?: ReactNode;
  children?: TreeNode[];
  /** Has children not loaded yet (lazy). */
  hasChildren?: boolean;
}

interface Flat {
  node: TreeNode;
  level: number;
  parent: string | null;
  posinset: number;
  setsize: number;
}

export interface TreeProps {
  nodes: TreeNode[];
  label: string;
  expanded: Set<string>;
  onExpandedChange(next: Set<string>): void;
  selected?: string | null;
  onSelect?(id: string, node: TreeNode): void;
  onActivate?(id: string, node: TreeNode): void;
  rowHeight?: number;
  height?: number | string;
}

export function Tree({ nodes, label, expanded, onExpandedChange, selected = null, onSelect, onActivate, rowHeight = 28, height = "100%" }: TreeProps) {
  const id = useId();
  const scroll = useRef<HTMLDivElement | null>(null);
  const flat = useMemo(() => {
    const out: Flat[] = [];
    const walk = (list: TreeNode[], level: number, parent: string | null) =>
      list.forEach((n, i) => {
        out.push({ node: n, level, parent, posinset: i + 1, setsize: list.length });
        if (expanded.has(n.id) && n.children) walk(n.children, level + 1, n.id);
      });
    walk(nodes, 1, null);
    return out;
  }, [nodes, expanded]);
  const [active, setActive] = useState<string | null>(selected ?? flat[0]?.node.id ?? null);
  useEffect(() => {
    if (selected) setActive(selected);
  }, [selected]);
  const v = useVirtualRows({ count: flat.length, rowHeight, scrollRef: scroll });
  const ai = Math.max(0, flat.findIndex((f) => f.node.id === active));
  const go = (i: number) => {
    const f = flat[i];
    if (!f) return;
    setActive(f.node.id);
    v.scrollToIndex(i);
  };
  const toggle = (n: TreeNode, open?: boolean) => {
    const next = new Set(expanded);
    const want = open ?? !expanded.has(n.id);
    if (want) next.add(n.id);
    else next.delete(n.id);
    onExpandedChange(next);
  };
  const typeahead = useRef({ s: "", t: 0 });
  const onKey = (e: KeyboardEvent) => {
    const f = flat[ai];
    if (!f) return;
    const has = !!(f.node.children?.length || f.node.hasChildren);
    const open = expanded.has(f.node.id);
    if (e.key === "ArrowDown") go(Math.min(flat.length - 1, ai + 1));
    else if (e.key === "ArrowUp") go(Math.max(0, ai - 1));
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(flat.length - 1);
    else if (e.key === "ArrowRight") {
      if (has && !open) toggle(f.node, true);
      else if (has) go(ai + 1);
    } else if (e.key === "ArrowLeft") {
      if (has && open) toggle(f.node, false);
      else if (f.parent) go(flat.findIndex((x) => x.node.id === f.parent));
    } else if (e.key === "Enter") {
      onSelect?.(f.node.id, f.node);
      onActivate?.(f.node.id, f.node);
    } else if (e.key === " ") {
      onSelect?.(f.node.id, f.node);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      typeahead.current = { s: (now - typeahead.current.t < 600 ? typeahead.current.s : "") + e.key.toLowerCase(), t: now };
      const s = typeahead.current.s;
      const hit = flat.findIndex((x, i) => i > ai - (s.length > 1 ? 1 : 0) && (x.node.text ?? String(x.node.label)).toLowerCase().startsWith(s));
      if (hit >= 0) go(hit);
      return;
    } else return;
    e.preventDefault();
  };
  const items = [];
  for (let i = v.start; i < Math.min(v.end, flat.length); i++) {
    const f = flat[i];
    const has = !!(f.node.children?.length || f.node.hasChildren);
    const open = expanded.has(f.node.id);
    items.push(
      <div
        key={f.node.id}
        id={`${id}-${i}`}
        role="treeitem"
        aria-level={f.level}
        aria-posinset={f.posinset}
        aria-setsize={f.setsize}
        aria-expanded={has ? open : undefined}
        aria-selected={f.node.id === selected}
        className={cx("dui-tree__item", f.node.id === active && "is-active", f.node.id === selected && "is-selected")}
        style={{ top: i * rowHeight, height: rowHeight, paddingLeft: 8 + (f.level - 1) * 16 }}
        title={f.node.text}
        onClick={() => {
          setActive(f.node.id);
          onSelect?.(f.node.id, f.node);
        }}
        onDoubleClick={() => (has ? toggle(f.node) : onActivate?.(f.node.id, f.node))}
      >
        <span
          className={cx("dui-tree__twisty", !has && "is-leaf")}
          onClick={(e) => {
            e.stopPropagation();
            if (has) toggle(f.node);
          }}
          aria-hidden="true"
        >
          {has && <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />}
        </span>
        {f.node.icon && <Icon name={f.node.icon} size={14} className="dui-tree__icon" />}
        <span className="dui-tree__label">{f.node.label}</span>
        {f.node.detail && <span className="dui-tree__detail">{f.node.detail}</span>}
        {f.node.badge}
      </div>,
    );
  }
  return (
    <div
      ref={scroll}
      className="dui-tree"
      role="tree"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={flat.length ? `${id}-${ai}` : undefined}
      onKeyDown={onKey}
      style={{ height }}
    >
      <div style={{ height: v.total, position: "relative" }} role="presentation">
        {items}
      </div>
    </div>
  );
}

// ---------- SplitPane ----------

export interface SplitPaneProps {
  /** Persist the split under this key. */
  storageKey: string;
  /** Initial size of the first pane, px. */
  initial: number;
  min?: number;
  max?: number;
  orientation?: "horizontal" | "vertical";
  children: [ReactNode, ReactNode];
  label?: string;
  className?: string;
}

export function SplitPane({ storageKey, initial, min = 160, max = 900, orientation = "horizontal", children, label = "Resize panes", className }: SplitPaneProps) {
  const [size, setSize] = usePersistentState(`dui-split:${storageKey}`, initial);
  const box = useRef<HTMLDivElement | null>(null);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const horiz = orientation === "horizontal";
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = box.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => setSize(clamp(horiz ? ev.clientX - rect.left : ev.clientY - rect.top));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("dui-resizing");
    };
    document.body.classList.add("dui-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const style: CSSProperties = horiz ? { gridTemplateColumns: `${size}px 1px minmax(0, 1fr)` } : { gridTemplateRows: `${size}px 1px minmax(0, 1fr)` };
  return (
    <div ref={box} className={cx("dui-split", `dui-split--${orientation}`, className)} style={style}>
      <div className="dui-split__pane">{children[0]}</div>
      <div
        className="dui-split__handle"
        role="separator"
        aria-label={label}
        aria-orientation={horiz ? "vertical" : "horizontal"}
        aria-valuenow={Math.round(size)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={start}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 64 : 16;
          if (e.key === (horiz ? "ArrowLeft" : "ArrowUp")) setSize(clamp(size - step));
          else if (e.key === (horiz ? "ArrowRight" : "ArrowDown")) setSize(clamp(size + step));
          else if (e.key === "Home") setSize(min);
          else if (e.key === "End") setSize(max);
          else return;
          e.preventDefault();
        }}
      />
      <div className="dui-split__pane">{children[1]}</div>
    </div>
  );
}

// ---------- Timeline ----------

export function Timeline({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ol className="dui-timeline" aria-label={label}>
      {children}
    </ol>
  );
}

export interface TimelineItemProps {
  time?: ReactNode;
  icon: IconName;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "muted";
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  id?: string;
  active?: boolean;
  className?: string;
}

export function TimelineItem({ time, icon, tone = "neutral", title, meta, children, id, active, className }: TimelineItemProps) {
  return (
    <li id={id} className={cx("dui-tl", `dui-tl--${tone}`, active && "is-active", className)}>
      <span className="dui-tl__time">{time}</span>
      <span className="dui-tl__node" aria-hidden="true">
        <Icon name={icon} size={12} />
      </span>
      <div className="dui-tl__content">
        <div className="dui-tl__head">
          <span className="dui-tl__title">{title}</span>
          {meta && <span className="dui-tl__meta">{meta}</span>}
        </div>
        {children && <div className="dui-tl__body">{children}</div>}
      </div>
    </li>
  );
}
