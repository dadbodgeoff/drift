// Display components: badges, state labels, evidence, metrics, panels and states.
import { type HTMLAttributes, type ReactNode, type Ref, forwardRef } from "react";
import { DriftMark, Icon, type IconName } from "../foundations/Icon";
import { cx } from "../foundations/hooks";
import { Button } from "./controls";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const TONE_ICON: Record<Tone, IconName> = {
  neutral: "dot",
  accent: "dot",
  success: "ok",
  warning: "attention",
  danger: "blocked",
  info: "info",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Show the tone's icon (state must never be colour alone). */
  icon?: IconName | boolean;
  variant?: "subtle" | "outline" | "solid";
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge({ tone = "neutral", icon, variant = "subtle", className, children, ...rest }, ref) {
  const name = icon === true ? TONE_ICON[tone] : icon || null;
  return (
    <span ref={ref} className={cx("dui-badge", `dui-badge--${tone}`, `dui-badge--${variant}`, className)} {...rest}>
      {name && <Icon name={name} size={12} />}
      {children}
    </span>
  );
});

/** A monospace token: an id, a path segment, a wrapper name. */
export function Tag({ children, className, title, tone }: { children: ReactNode; className?: string; title?: string; tone?: Tone }) {
  return (
    <span className={cx("dui-tag", tone && `dui-tag--${tone}`, className)} title={title}>
      {children}
    </span>
  );
}

/** A coloured dot with a text label (never the dot alone). */
export function StatusDot({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={cx("dui-statusdot", `dui-statusdot--${tone}`)}>
      <span className="dui-statusdot__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/** A state shown with icon, label and colour together. */
export function StateLabel({ tone, icon, children, title }: { tone: Tone; icon?: IconName; children: ReactNode; title?: string }) {
  return (
    <span className={cx("dui-state", `dui-state--${tone}`)} title={title}>
      <Icon name={icon ?? TONE_ICON[tone]} size={13} />
      <span>{children}</span>
    </span>
  );
}

export interface EvidenceChipProps {
  holders: number;
  total: number;
  lowerBound?: number;
  lift?: number;
  compact?: boolean;
}

/** Members drawn one mark each up to this many; above it the chip draws a proportional bar. */
export const TALLY_MAX = 30;

/** The 95% Wilson score interval for `holders` of `total` (Drift's lower bound uses the same formula). */
export function wilson(holders: number, total: number, z = 1.96): { low: number; high: number } {
  if (!total) return { low: 0, high: 0 };
  const p = holders / total;
  const d = 1 + (z * z) / total;
  const c = p + (z * z) / (2 * total);
  const r = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return { low: Math.max(0, (c - r) / d), high: Math.min(1, (c + r) / d) };
}

function evidenceLabel(holders: number, total: number, lowerBound?: number, lift?: number) {
  return `${holders} of ${total} follow it${lowerBound !== undefined ? `, lower bound ${lowerBound.toFixed(2)}` : ""}${lift !== undefined ? `, lift ${lift.toFixed(1)}` : ""}`;
}

/** One mark per role member: holders filled, outliers hollow. A proportional bar above TALLY_MAX. */
export function Tally({ holders, total, max = TALLY_MAX, className }: { holders: number; total: number; max?: number; className?: string }) {
  if (total > max || total === 0) {
    const share = total ? holders / total : 0;
    return (
      <span className={cx("dui-tally", "is-bar", className)} aria-hidden="true">
        <span className="dui-tally__fill" style={{ width: `${share * 100}%` }} />
        <span className="dui-tally__rest" style={{ width: `${(1 - share) * 100}%` }} />
      </span>
    );
  }
  return (
    <span className={cx("dui-tally", className)} aria-hidden="true" style={{ ["--tally-n" as string]: total }}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < holders ? "dui-tally__m" : "dui-tally__m is-out"} />
      ))}
    </span>
  );
}

/** `53/54 · LB 0.90 · lift 36`, with a tally of the role's members. */
export function EvidenceChip({ holders, total, lowerBound, lift, compact }: EvidenceChipProps) {
  const label = evidenceLabel(holders, total, lowerBound, lift);
  return (
    <span className={cx("dui-evidence", compact && "is-compact")} title={label} aria-label={label} role="img">
      <Tally holders={holders} total={total} />
      <span className="dui-evidence__text" aria-hidden="true">
        <b>
          {holders}/{total}
        </b>
        {lowerBound !== undefined && <span> · LB {lowerBound.toFixed(2)}</span>}
        {!compact && lift !== undefined && <span> · lift {lift >= 10 ? Math.round(lift) : lift.toFixed(1)}</span>}
      </span>
    </span>
  );
}

export interface EvidenceGaugeProps {
  holders: number;
  total: number;
  /** Drift's 95% Wilson lower bound. */
  lowerBound: number;
  lift: number;
  /** The lower bound a fact needs to become a proposal (`min_lower_bound` in census params). */
  threshold?: number | null;
  /** Called with nothing; shown as a link on the outlier legend. */
  onOutliers?: () => void;
}

/**
 * The evidence behind a convention, drawn in full: every member of the role
 * (holders filled, outliers hollow), the share with its 95% Wilson interval on
 * a 50 to 100% axis, the threshold Drift proposes at, and the lift.
 */
/** How close (as a share of the axis) the lower bound's label may come to an end label before that end label is left out. */
const TICK_CLEAR = 0.2;
/** Near an end, the lower bound's label is aligned to the end instead of centred, so it stays inside the axis. */
const TICK_EDGE = 0.08;

export function EvidenceGauge({ holders, total, lowerBound, lift, threshold, onOutliers }: EvidenceGaugeProps) {
  const share = total ? holders / total : 0;
  const { high } = wilson(holders, total);
  const lo = 0.5;
  const x = (v: number) => `${Math.max(0, Math.min(1, (v - lo) / (1 - lo))) * 100}%`;
  const outliers = total - holders;
  // Where the lower bound's label sits on the axis, 0 (50%) to 1 (100%).
  const lbAt = Math.max(0, Math.min(1, (lowerBound - lo) / (1 - lo)));
  const label = `${evidenceLabel(holders, total, lowerBound, lift)}. 95% interval ${lowerBound.toFixed(2)} to ${high.toFixed(2)}${threshold ? `; Drift proposes at a lower bound of ${threshold.toFixed(2)} or more` : ""}.`;
  const cells = Math.min(total, 400);
  return (
    <figure className="dui-gauge">
      <figcaption className="dui-sr">{label}</figcaption>
      <div className="dui-gauge__readouts" aria-hidden="true">
        <div className="dui-gauge__readout is-primary">
          <span className="dui-gauge__value">
            {holders.toLocaleString()}
            <span className="dui-gauge__of">/{total.toLocaleString()}</span>
          </span>
          <span className="dui-gauge__label">follow it · {Math.round(share * 100)}%</span>
        </div>
        <div className="dui-gauge__readout">
          <span className="dui-gauge__value">{lowerBound.toFixed(2)}</span>
          <span className="dui-gauge__label">lower bound (95%)</span>
        </div>
        <div className="dui-gauge__readout">
          <span className="dui-gauge__value">
            {lift >= 10 ? Math.round(lift) : lift.toFixed(1)}
            <span className="dui-gauge__of">×</span>
          </span>
          <span className="dui-gauge__label">lift vs. the repo</span>
        </div>
      </div>
      <div className="dui-gauge__units" aria-hidden="true" style={{ ["--units" as string]: cells }}>
        {Array.from({ length: cells }, (_, i) => (
          <span key={i} className={i < Math.round((holders / total) * cells) ? "dui-gauge__unit" : "dui-gauge__unit is-out"} />
        ))}
      </div>
      <div className="dui-gauge__legend">
        <span>
          <span className="dui-gauge__key" /> follows ({holders.toLocaleString()})
        </span>
        <span>
          <span className="dui-gauge__key is-out" />{" "}
          {onOutliers && outliers > 0 ? (
            <button type="button" className="dui-gauge__link" onClick={onOutliers}>
              outliers ({outliers.toLocaleString()})
            </button>
          ) : (
            <>outliers ({outliers.toLocaleString()})</>
          )}
        </span>
        {total > 400 && <span>one mark per {(total / 400).toFixed(1)} members</span>}
      </div>
      <div className="dui-gauge__axis" aria-hidden="true">
        <div className="dui-gauge__track">
          {threshold != null && <span className="dui-gauge__threshold" style={{ left: x(threshold) }} title={`Drift proposes at a lower bound of ${threshold}`} />}
          <span className="dui-gauge__interval" style={{ left: x(lowerBound), width: `calc(${x(high)} - ${x(lowerBound)})` }} />
          <span className="dui-gauge__point" style={{ left: x(share) }} />
        </div>
        <div className="dui-gauge__ticks">
          {/* The end labels give way to the lower bound's when it sits near them, so the two never overlap ("LB 91100%"). */}
          {lbAt > TICK_CLEAR && (
            <span className="is-start" style={{ left: "0%" }}>
              50%
            </span>
          )}
          {threshold != null && (
            <span className="is-threshold" style={{ left: x(threshold) }}>
              proposes at {Math.round(threshold * 100)}
            </span>
          )}
          <span className={cx("is-lb", lbAt < TICK_EDGE && "is-start", lbAt > 1 - TICK_EDGE && "is-end")} style={{ left: x(lowerBound) }}>
            LB {Math.round(lowerBound * 100)}
          </span>
          {lbAt < 1 - TICK_CLEAR && (
            <span className="is-end" style={{ left: "100%" }}>
              100%
            </span>
          )}
        </div>
      </div>
    </figure>
  );
}

export interface LoopStation {
  /** Overline: the step (`Learn`, `Propose`, ...). */
  step: string;
  value: ReactNode;
  /** What the value counts. */
  unit: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
  onClick?: () => void;
  shortcut?: string;
}

/** Drift's loop, left to right, each station with a real number and a way in. */
export function LoopStrip({ stations, label }: { stations: LoopStation[]; label: string }) {
  return (
    <ol className="dui-loop" aria-label={label}>
      {stations.map((s, i) => {
        const body = (
          <>
            <span className="dui-loop__step">
              <span className="dui-loop__index">{String(i + 1).padStart(2, "0")}</span>
              {s.step}
            </span>
            <span className={cx("dui-loop__value", s.tone && `t-${s.tone}`)}>{s.value}</span>
            <span className="dui-loop__unit">{s.unit}</span>
            {s.detail && <span className="dui-loop__detail">{s.detail}</span>}
            {s.shortcut && <span className="dui-loop__kbd">{s.shortcut}</span>}
          </>
        );
        return (
          <li key={i} className="dui-loop__station">
            {s.onClick ? (
              <button type="button" className="dui-loop__btn" onClick={s.onClick}>
                {body}
              </button>
            ) : (
              <div className="dui-loop__btn">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export interface SelectorPart {
  /** What this part selects on (`package`, `directory`, ...). */
  key: string;
  value: ReactNode;
  mono?: boolean;
}

/** A role selector read left to right: each part narrows the one before. */
export function Selector({ parts, trailing, label = "Role" }: { parts: SelectorPart[]; trailing?: ReactNode; label?: string }) {
  return (
    <ol className="dui-selector" aria-label={label}>
      {parts.map((p, i) => (
        <li key={i} className="dui-selector__part">
          <span className="dui-selector__key">{p.key}</span>
          <span className={cx("dui-selector__value", p.mono && "dui-mono")}>{p.value}</span>
        </li>
      ))}
      {trailing && <li className="dui-selector__trailing">{trailing}</li>}
    </ol>
  );
}

export type DriftMessageKind = "session" | "primed" | "practices" | "facts" | "advised" | "unsure" | "blocked" | "unsure_start" | "unsure_again" | "denied" | "stepped_aside" | "recovered" | "unchecked" | "exempt" | "unwired" | "lookup" | "brief" | "error";

/** Drift's hook messages, by what they did. The hook names the moment in the agent's turn. */
export const DRIFT_MESSAGE: Record<DriftMessageKind, { tone: Tone; icon: IconName; label: string; hook: string }> = {
  session: { tone: "info", icon: "info", label: "Session start: baseline recorded", hook: "SessionStart" },
  primed: { tone: "accent", icon: "sparkle", label: "Rules before a new file", hook: "PreToolUse" },
  practices: { tone: "neutral", icon: "layers", label: "Practices: the recipe to copy, facts not rules", hook: "SessionStart" },
  facts: { tone: "info", icon: "info", label: "What the edits introduced (a risky operation, a new package dependency) and what of it still stands: facts not rules, never blocks", hook: "PostToolUse" },
  denied: { tone: "danger", icon: "blocked", label: "Denied a write to Drift policy", hook: "PreToolUse" },
  advised: { tone: "warning", icon: "attention", label: "Advice after an edit", hook: "PostToolUse" },
  unsure: { tone: "info", icon: "info", label: "Possible violations, not certain: depend on files not checked", hook: "PostToolUse" },
  blocked: { tone: "danger", icon: "blocked", label: "Blocked the end of the turn", hook: "Stop" },
  unsure_start: { tone: "info", icon: "info", label: "Blocked on violations unsure at session start: may predate it", hook: "Stop" },
  unsure_again: { tone: "neutral", icon: "info", label: "Unsure at session start, still there: advice now (blocked once)", hook: "Stop" },
  stepped_aside: { tone: "neutral", icon: "info", label: "Stepped aside: loop guard", hook: "Stop" },
  recovered: { tone: "info", icon: "info", label: "Baseline recovered: session state was missing", hook: "Stop" },
  unwired: { tone: "warning", icon: "attention", label: "Not wired up yet: advice, never blocks", hook: "Stop" },
  lookup: { tone: "info", icon: "info", label: "Search hint: Drift knows this (drift card)", hook: "PreToolUse" },
  brief: { tone: "info", icon: "info", label: "Session brief: packages, entry points, where to ask first", hook: "SessionStart" },
  unchecked: { tone: "warning", icon: "attention", label: "Not checked: no stack to parse the file", hook: "PostToolUse" },
  exempt: { tone: "neutral", icon: "dot", label: "Not checked: members a convention is not about", hook: "PostToolUse" },
  error: { tone: "neutral", icon: "attention", label: "Hook error (Drift never blocks on its own failure)", hook: "" },
};

export interface DriftMessageProps {
  kind: DriftMessageKind;
  /** The hook event (`SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`); defaults to the kind's usual hook. */
  hook?: string;
  /** Convention ids the message names. */
  ids?: string[];
  /** Makes each id a link (to the convention). */
  onId?: (id: string) => void;
  /** The message exactly as the agent received it (rendered as text, never markup). */
  text: string;
  /** Findings or links under the message. */
  children?: ReactNode;
}

/** What Drift said to an agent, verbatim, with the hook it came from. One look everywhere. */
export function DriftMessage({ kind, hook, ids = [], onId, text, children }: DriftMessageProps) {
  const m = DRIFT_MESSAGE[kind];
  const h = hook ?? m.hook;
  return (
    <figure className={cx("dui-dmsg", `dui-dmsg--${m.tone}`, `is-${kind}`)}>
      <figcaption className="dui-dmsg__head">
        <span className="dui-dmsg__who">
          <DriftMark size={14} />
          Drift to the agent
        </span>
        <StateLabel tone={m.tone} icon={m.icon}>
          {m.label}
        </StateLabel>
        {ids.map((x) =>
          onId ? (
            <button key={x} type="button" className="dui-tag dui-dmsg__id" onClick={() => onId(x)} title={`Open ${x}`}>
              {x}
            </button>
          ) : (
            <Tag key={x}>{x}</Tag>
          ),
        )}
        <span className="dui-dmsg__grow" />
        {h && <span className="dui-dmsg__hook">{h}</span>}
      </figcaption>
      <div className="dui-dmsg__label">As the agent received it</div>
      <pre className="dui-dmsg__body">{text}</pre>
      {children && <div className="dui-dmsg__foot">{children}</div>}
    </figure>
  );
}

export interface TierBadgeProps {
  /** The CLI's confidence tier: `default` may block once accepted; `suggestion` advises. */
  tier: "default" | "suggestion";
  /** Why a suggestion is not in the default tier, in words (`names a package symbol`). */
  reason?: string | null;
  /** Without the reason text (it stays in the tooltip). */
  compact?: boolean;
}

/** The confidence tier, the same way everywhere: default tier (can block) or suggestion (advice), and why. */
export function TierBadge({ tier, reason, compact }: TierBadgeProps) {
  const title =
    tier === "default"
      ? "Default tier: may block once accepted (drift review, b)"
      : `Suggestion: advice only; blocking it needs drift review --block --force${reason ? `. Why: ${reason}` : ""}`;
  return (
    <span className={cx("dui-tier", `dui-tier--${tier}`)} title={title}>
      <Badge tone={tier === "default" ? "info" : "neutral"} variant={tier === "default" ? "subtle" : "outline"} icon={tier === "default" ? "shield" : "info"}>
        {tier === "default" ? "default tier" : "suggestion"}
      </Badge>
      {!compact && reason && <span className="dui-tier__why">{reason}</span>}
    </span>
  );
}

export interface ConfidenceTierProps {
  /** From the CLI when it tiers proposals (`default` | `suggestion`). */
  tier?: string | null;
  /** Study accept rate for this rule family, shown as a hint until the CLI tiers. */
  hint?: { rate: number; n: number; family: string; source: string } | null;
}

/** Where a reviewer should look hardest. */
export function ConfidenceTier({ tier, hint }: ConfidenceTierProps) {
  if (tier && tier !== "default")
    return (
      <Badge tone="warning" icon="attention" title="Drift proposes this as a suggestion: weaker evidence">
        {tier}
      </Badge>
    );
  if (!hint) return tier ? <Badge tone="neutral">{tier}</Badge> : null;
  const pct = Math.round(hint.rate * 100);
  const tone: Tone = pct >= 70 ? "success" : pct >= 50 ? "neutral" : "warning";
  return (
    <span className={cx("dui-confidence", `dui-confidence--${tone}`)} title={`${hint.family}: ${pct}% accepted by blind reviewers (n=${hint.n}). Source: ${hint.source}. A hint, not a verdict.`}>
      <Icon name={tone === "warning" ? "attention" : tone === "success" ? "ok" : "info"} size={12} />
      <span>
        {hint.family} · {pct}% accepted
      </span>
    </span>
  );
}

export function KeyValue({ items, columns = 1, className }: { items: { key: ReactNode; value: ReactNode; mono?: boolean }[]; columns?: number; className?: string }) {
  return (
    <dl className={cx("dui-kv", className)} style={{ ["--kv-cols" as string]: columns }}>
      {items.map((it, i) => (
        <div key={i} className="dui-kv__row">
          <dt>{it.key}</dt>
          <dd className={it.mono ? "dui-mono" : undefined}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** Change since a reference point; positive is shown as `+n`. */
  delta?: { value: number; label?: string; good?: "up" | "down" | "none" };
  hint?: ReactNode;
  tone?: Tone;
  icon?: IconName;
  chart?: ReactNode;
  onClick?: () => void;
  shortcut?: string;
}

export function Stat({ label, value, delta, hint, tone, icon, chart, onClick, shortcut }: StatProps) {
  const body = (
    <>
      <span className="dui-stat__label">
        {icon && <Icon name={icon} size={13} />}
        {label}
      </span>
      <span className="dui-stat__value">{value}</span>
      {(delta || hint) && (
        <span className="dui-stat__meta">
          {delta && delta.value !== 0 && (
            <span className={cx("dui-delta", deltaTone(delta))}>
              <Icon name={delta.value > 0 ? "chevron-up" : "chevron-down"} size={11} />
              {Math.abs(delta.value).toLocaleString()} {delta.label}
            </span>
          )}
          {hint && <span className="dui-stat__hint">{hint}</span>}
        </span>
      )}
      {chart && <span className="dui-stat__chart">{chart}</span>}
      {shortcut && <span className="dui-stat__kbd">{shortcut}</span>}
    </>
  );
  const cls = cx("dui-stat", tone && `dui-stat--${tone}`, onClick && "is-interactive");
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function deltaTone(d: NonNullable<StatProps["delta"]>): string {
  if (!d.good || d.good === "none") return "is-neutral";
  return (d.value > 0) === (d.good === "up") ? "is-good" : "is-bad";
}

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  padded?: boolean;
  as?: "section" | "div" | "article";
  ref?: Ref<HTMLElement>;
}

export function Panel({ title, subtitle, actions, padded = true, as: As = "section", className, children, ref, ...rest }: PanelProps) {
  return (
    <As ref={ref as Ref<HTMLDivElement>} className={cx("dui-panel", className)} {...rest}>
      {(title || actions) && (
        <header className="dui-panel__head">
          <div className="dui-panel__titles">
            {title && <h3 className="dui-panel__title">{title}</h3>}
            {subtitle && <p className="dui-panel__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="dui-panel__actions">{actions}</div>}
        </header>
      )}
      <div className={cx("dui-panel__body", padded && "is-padded")}>{children}</div>
    </As>
  );
}

export function EmptyState({ icon = "sparkle", title, children, action }: { icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="dui-empty" role="status">
      <span className="dui-empty__icon">
        <Icon name={icon} size={20} />
      </span>
      <p className="dui-empty__title">{title}</p>
      {children && <div className="dui-empty__body">{children}</div>}
      {action && <div className="dui-empty__action">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", error, onRetry, children }: { title?: ReactNode; error?: unknown; onRetry?: () => void; children?: ReactNode }) {
  const message = error instanceof Error ? error.message : error ? String(error) : null;
  return (
    <div className="dui-empty dui-error" role="alert">
      <span className="dui-empty__icon">
        <Icon name="blocked" size={20} />
      </span>
      <p className="dui-empty__title">{title}</p>
      {message && <pre className="dui-error__message">{message}</pre>}
      {children && <div className="dui-empty__body">{children}</div>}
      {onRetry && (
        <div className="dui-empty__action">
          <Button icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: ReactNode; onClick?: () => void; title?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="dui-crumbs">
      <ol>
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i}>
              {it.onClick && !last ? (
                <button type="button" onClick={it.onClick} title={it.title}>
                  {it.label}
                </button>
              ) : (
                <span aria-current={last ? "page" : undefined} title={it.title}>
                  {it.label}
                </span>
              )}
              {!last && <Icon name="chevron-right" size={12} className="dui-crumbs__sep" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Text for screen readers only. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="dui-sr">{children}</span>;
}
