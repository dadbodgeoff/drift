// Overlays: tooltip, popover, menu, context menu, dialog, confirm dialog,
// drawer, toasts and the command palette. Modal overlays trap focus and
// restore it on close; Escape closes the topmost one.
import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "../foundations/Icon";
import { cx, useFocusTrap } from "../foundations/hooks";
import { Button, IconButton, Kbd } from "./controls";

function Portal({ children }: { children: ReactNode }) {
  return typeof document === "undefined" ? null : createPortal(children, document.body);
}

// ---------- positioning ----------

type Side = "top" | "bottom" | "left" | "right";

function place(anchor: DOMRect, el: DOMRect, side: Side, gap = 6): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top: number;
  let left: number;
  if (side === "bottom" || side === "top") {
    left = anchor.left + anchor.width / 2 - el.width / 2;
    top = side === "bottom" ? anchor.bottom + gap : anchor.top - el.height - gap;
    if (side === "bottom" && top + el.height > vh - 4) top = anchor.top - el.height - gap;
    if (side === "top" && top < 4) top = anchor.bottom + gap;
  } else {
    top = anchor.top + anchor.height / 2 - el.height / 2;
    left = side === "right" ? anchor.right + gap : anchor.left - el.width - gap;
  }
  return { top: Math.max(4, Math.min(top, vh - el.height - 4)), left: Math.max(4, Math.min(left, vw - el.width - 4)) };
}

function usePlacement(anchor: RefObject<HTMLElement | null>, el: RefObject<HTMLElement | null>, open: boolean, side: Side, align?: "start") {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const update = () => {
      if (!anchor.current || !el.current) return;
      const a = anchor.current.getBoundingClientRect();
      const r = el.current.getBoundingClientRect();
      const p = place(a, r, side);
      if (align === "start" && (side === "bottom" || side === "top")) p.left = Math.max(4, Math.min(a.left, window.innerWidth - r.width - 4));
      setPos(p);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, side, anchor, el, align]);
  return pos;
}

// ---------- Tooltip ----------

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactElement<Record<string, unknown>>; side?: Side }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement | null>(null);
  const pos = usePlacement(anchor, tip, open, side);
  const timer = useRef<number | undefined>(undefined);
  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 350);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  const child = cloneElement(children, {
    ref: (el: HTMLElement | null) => {
      anchor.current = el;
    },
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: () => setOpen(true),
    onBlur: hide,
    "aria-describedby": open ? id : undefined,
  });
  return (
    <>
      {child}
      {open && (
        <Portal>
          <div ref={tip} id={id} role="tooltip" className="dui-tooltip" style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }}>
            {content}
          </div>
        </Portal>
      )}
    </>
  );
}

// ---------- Popover ----------

export interface PopoverProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  side?: Side;
  label: string;
  className?: string;
}

export function Popover({ open, onOpenChange, anchor, children, side = "bottom", label, className }: PopoverProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const pos = usePlacement(anchor, el, open, side, "start");
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!el.current?.contains(t) && !anchor.current?.contains(t)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange(false);
        anchor.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onOpenChange, anchor]);
  if (!open) return null;
  return (
    <Portal>
      <div ref={el} role="dialog" aria-label={label} className={cx("dui-popover", className)} style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }}>
        {children}
      </div>
    </Portal>
  );
}

// ---------- Menu ----------

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: IconName;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect(): void;
}

function MenuList({ items, onClose, labelledBy, style, listRef }: { items: (MenuItem | "separator")[]; onClose(): void; labelledBy?: string; style?: React.CSSProperties; listRef: RefObject<HTMLDivElement | null> }) {
  const actionable = items.filter((i): i is MenuItem => i !== "separator" && !i.disabled);
  const [active, setActive] = useState(0);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    refs.current[actionable[active]?.id]?.focus();
  }, [active, actionable]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((a) => (a + 1) % actionable.length);
    else if (e.key === "ArrowUp") setActive((a) => (a - 1 + actionable.length) % actionable.length);
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(actionable.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") onClose();
    else return;
    e.preventDefault();
  };
  return (
    <div ref={listRef} role="menu" aria-labelledby={labelledBy} className="dui-menu" style={style} onKeyDown={onKey}>
      {items.map((it, i) =>
        it === "separator" ? (
          <div key={`s${i}`} role="separator" className="dui-menu__sep" />
        ) : (
          <button
            key={it.id}
            ref={(el) => {
              refs.current[it.id] = el;
            }}
            role="menuitem"
            type="button"
            tabIndex={-1}
            disabled={it.disabled}
            className={cx("dui-menu__item", it.danger && "is-danger")}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            {it.icon ? <Icon name={it.icon} size={14} /> : <span className="dui-menu__spacer" />}
            <span className="dui-menu__label">{it.label}</span>
            {it.shortcut && <Kbd>{it.shortcut}</Kbd>}
          </button>
        ),
      )}
    </div>
  );
}

export function Menu({ trigger, items, label }: { trigger: ReactElement<Record<string, unknown>>; items: (MenuItem | "separator")[]; label: string }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const pos = usePlacement(anchor, list, open, "bottom", "start");
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !anchor.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const close = useCallback(() => {
    setOpen(false);
    anchor.current?.focus();
  }, []);
  const t = cloneElement(trigger, {
    ref: (el: HTMLElement | null) => {
      anchor.current = el;
    },
    id,
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-label": trigger.props["aria-label"] as string | undefined,
    title: (trigger.props.title as string | undefined) ?? label,
    onClick: () => setOpen((o) => !o),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
    },
  });
  return (
    <>
      {t}
      {open && (
        <Portal>
          <MenuList items={items} onClose={close} labelledBy={id} listRef={list} style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }} />
        </Portal>
      )}
    </>
  );
}

/** Right-click (or Shift+F10 / the context-menu key) opens a menu at the pointer. */
export function ContextMenu({ items, children, label }: { items: (MenuItem | "separator")[]; children: ReactElement<Record<string, unknown>>; label: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!at) return;
    const onDown = (e: MouseEvent) => !list.current?.contains(e.target as Node) && setAt(null);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [at]);
  const child = cloneElement(children, {
    "aria-haspopup": "menu",
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      origin.current = e.currentTarget as HTMLElement;
      setAt({ x: e.clientX, y: e.clientY });
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      (children.props.onKeyDown as ((e: React.KeyboardEvent) => void) | undefined)?.(e);
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        origin.current = e.currentTarget as HTMLElement;
        setAt({ x: r.left + 12, y: r.bottom });
      }
    },
  });
  return (
    <>
      {child}
      {at && (
        <Portal>
          <MenuList
            items={items}
            listRef={list}
            onClose={() => {
              setAt(null);
              origin.current?.focus();
            }}
            style={{ top: Math.min(at.y, window.innerHeight - 40 - items.length * 30), left: Math.min(at.x, window.innerWidth - 240) }}
          />
          <span className="dui-sr">{label}</span>
        </Portal>
      )}
    </>
  );
}

// ---------- Dialog ----------

export interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  initialFocus?: RefObject<HTMLElement | null>;
  /** For alert dialogs (destructive confirmations). */
  role?: "dialog" | "alertdialog";
}

export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md", initialFocus, role = "dialog" }: DialogProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const tid = useId();
  const did = useId();
  useFocusTrap(ref, open, initialFocus);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [open, onOpenChange]);
  if (!open) return null;
  return (
    <Portal>
      <div className="dui-scrim" onMouseDown={(e) => e.target === e.currentTarget && onOpenChange(false)}>
        <div ref={ref} role={role} aria-modal="true" aria-labelledby={tid} aria-describedby={description ? did : undefined} className={cx("dui-dialog", `dui-dialog--${size}`)}>
          <header className="dui-dialog__head">
            <h2 id={tid} className="dui-dialog__title">
              {title}
            </h2>
            <IconButton icon="x" label="Close" size="sm" onClick={() => onOpenChange(false)} />
          </header>
          {description && (
            <p id={did} className="dui-dialog__desc">
              {description}
            </p>
          )}
          {children && <div className="dui-dialog__body">{children}</div>}
          {footer && <footer className="dui-dialog__foot">{footer}</footer>}
        </div>
      </div>
    </Portal>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  onConfirm(): void;
}

export function ConfirmDialog({ open, onOpenChange, title, description, children, confirmLabel, cancelLabel = "Cancel", tone = "primary", onConfirm }: ConfirmDialogProps) {
  const cancel = useRef<HTMLButtonElement | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      role="alertdialog"
      size="sm"
      initialFocus={cancel}
      footer={
        <>
          <Button ref={cancel} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

// ---------- Drawer ----------

export interface DrawerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  width?: number;
  /** Modal drawers trap focus and dim the page. */
  modal?: boolean;
}

export function Drawer({ open, onOpenChange, title, subtitle, actions, children, width = 720, modal = true }: DrawerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const tid = useId();
  useFocusTrap(ref, open && modal);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [open, onOpenChange]);
  if (!open) return null;
  const panel = (
    <div ref={ref} role="dialog" aria-modal={modal} aria-labelledby={tid} className="dui-drawer" style={{ width: `min(${width}px, 100vw - 48px)` }}>
      <header className="dui-drawer__head">
        <div className="dui-drawer__titles">
          <h2 id={tid} className="dui-drawer__title">
            {title}
          </h2>
          {subtitle && <div className="dui-drawer__subtitle">{subtitle}</div>}
        </div>
        <div className="dui-drawer__actions">
          {actions}
          <IconButton icon="x" label="Close" onClick={() => onOpenChange(false)} />
        </div>
      </header>
      <div className="dui-drawer__body">{children}</div>
    </div>
  );
  return <Portal>{modal ? <div className="dui-scrim dui-scrim--drawer" onMouseDown={(e) => e.target === e.currentTarget && onOpenChange(false)}>{panel}</div> : panel}</Portal>;
}

// ---------- Toast ----------

export interface ToastOptions {
  title: ReactNode;
  body?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  /** ms; 0 keeps it until dismissed. */
  duration?: number;
  action?: { label: string; onClick(): void; shortcut?: string };
  /** Shows a countdown bar (e.g. an undo window). */
  countdown?: boolean;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const ToastCtx = createContext<{ show(t: ToastOptions): number; dismiss(id: number): void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (t: ToastOptions) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      const d = t.duration ?? 5000;
      if (d > 0) window.setTimeout(() => dismiss(id), d);
      return id;
    },
    [dismiss],
  );
  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <Portal>
        <div className="dui-toasts" role="region" aria-label="Notifications">
          <div aria-live="polite" aria-atomic="false">
            {items.map((t) => {
              const icon: IconName = t.tone === "success" ? "ok" : t.tone === "warning" ? "attention" : t.tone === "danger" ? "blocked" : "info";
              return (
                <div key={t.id} className={cx("dui-toast", `dui-toast--${t.tone ?? "neutral"}`)} role="status">
                  <Icon name={icon} size={16} className="dui-toast__icon" />
                  <div className="dui-toast__text">
                    <div className="dui-toast__title">{t.title}</div>
                    {t.body && <div className="dui-toast__body">{t.body}</div>}
                  </div>
                  {t.action && (
                    <Button
                      size="sm"
                      variant="secondary"
                      shortcut={t.action.shortcut}
                      onClick={() => {
                        t.action!.onClick();
                        dismiss(t.id);
                      }}
                    >
                      {t.action.label}
                    </Button>
                  )}
                  <IconButton icon="x" label="Dismiss" size="sm" onClick={() => dismiss(t.id)} />
                  {t.countdown && t.duration ? <span className="dui-toast__countdown" style={{ animationDuration: `${t.duration}ms` }} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      </Portal>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error("useToast needs a <ToastProvider>");
  return v;
}

// ---------- Command palette ----------

export interface Command {
  id: string;
  group: string;
  label: string;
  /** Secondary text (a path, an id). */
  detail?: string;
  icon?: IconName;
  shortcut?: string;
  keywords?: string;
  run(): void;
}

/** Subsequence match score (higher is better), or -1. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const idx = t.indexOf(q);
  if (idx >= 0) return 1000 - idx - t.length * 0.1 + (idx === 0 || /[\s/#.-]/.test(t[idx - 1]) ? 200 : 0);
  let ti = 0;
  let score = 0;
  let last = -2;
  for (const c of q) {
    const f = t.indexOf(c, ti);
    if (f < 0) return -1;
    score += f === last + 1 ? 8 : 1;
    last = f;
    ti = f + 1;
  }
  return score - t.length * 0.05;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  commands: Command[];
  /** Extra results computed from the query (files, sessions). */
  search?: (q: string) => Command[];
  placeholder?: string;
}

export function CommandPalette({ open, onOpenChange, commands, search, placeholder = "Jump to a view, file, convention or session" }: CommandPaletteProps) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  useFocusTrap(box, open, input);
  // Clear the query when the palette closes, not when it opens: the component stays mounted
  // while closed, and a reset on open lands a frame late, so a reopened palette showed the last
  // query and a fast first keystroke was appended to it (the reset then lost to that keystroke).
  useEffect(() => {
    if (!open) {
      setQ("");
      setActive(0);
    }
  }, [open]);
  const results = useMemo(() => {
    if (!q) return commands.slice(0, 80);
    const score = (c: Command) => Math.max(fuzzyScore(q, c.label), fuzzyScore(q, `${c.detail ?? ""} ${c.keywords ?? ""}`) - 50);
    const all = [...commands, ...(search ? search(q) : [])];
    return all
      .map((c) => ({ c, s: score(c) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 80)
      .map((x) => x.c)
      // Keep each group together, in the order of its best match.
      .reduce<Command[][]>((groups, c) => {
        const g = groups.find((x) => x[0].group === c.group);
        if (g) g.push(c);
        else groups.push([c]);
        return groups;
      }, [])
      .flat();
  }, [q, commands, search]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);
  if (!open) return null;
  const run = (c: Command | undefined) => {
    if (!c) return;
    onOpenChange(false);
    c.run();
  };
  let lastGroup = "";
  return (
    <Portal>
      <div className="dui-scrim dui-scrim--palette" onMouseDown={(e) => e.target === e.currentTarget && onOpenChange(false)}>
        <div ref={box} className="dui-palette" role="dialog" aria-modal="true" aria-label="Command palette">
          <div className="dui-palette__input">
            <Icon name="search" size={16} />
            <input
              ref={input}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
              aria-autocomplete="list"
              placeholder={placeholder}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") setActive((a) => Math.min(results.length - 1, a + 1));
                else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
                else if (e.key === "Enter") run(results[active]);
                else if (e.key === "Escape") onOpenChange(false);
                else return;
                e.preventDefault();
              }}
            />
            <Kbd>esc</Kbd>
          </div>
          <div id={listId} role="listbox" aria-label="Results" className="dui-palette__list">
            {results.length === 0 && <div className="dui-palette__empty">No matches for “{q}”</div>}
            {results.map((c, i) => {
              const head = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return (
                <div key={`${c.group}:${c.id}`} role="presentation">
                  {head && (
                    <div className="dui-palette__group" role="presentation">
                      {head}
                    </div>
                  )}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={cx("dui-palette__item", i === active && "is-active")}
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(c)}
                  >
                    {c.icon && <Icon name={c.icon} size={14} />}
                    <span className="dui-palette__label">{c.label}</span>
                    {c.detail && <span className="dui-palette__detail">{c.detail}</span>}
                    {c.shortcut && <Kbd>{c.shortcut}</Kbd>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="dui-palette__foot">
            <span>
              <Kbd>up</Kbd>
              <Kbd>down</Kbd> to move
            </span>
            <span>
              <Kbd>enter</Kbd> to open
            </span>
          </div>
        </div>
      </div>
    </Portal>
  );
}
