// Form controls and small primitives.
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  forwardRef,
  useId,
  useRef,
} from "react";
import { Icon, type IconName } from "../foundations/Icon";
import { cx, shortcutLabel } from "../foundations/hooks";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
export type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  /** Shortcut shown in the button (`mod+k`, `a`). */
  shortcut?: string;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, iconRight, shortcut, loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("dui-btn", `dui-btn--${variant}`, `dui-btn--${size}`, loading && "is-loading", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={12} /> : icon ? <Icon name={icon} size={14} /> : null}
      {children != null && <span className="dui-btn__label">{children}</span>}
      {iconRight && <Icon name={iconRight} size={14} />}
      {shortcut && <Kbd className="dui-btn__kbd">{shortcut}</Kbd>}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Required: icon buttons have no visible text. */
  label: string;
  variant?: ButtonVariant;
  size?: Size;
  pressed?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = "ghost", size = "md", pressed, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("dui-btn", "dui-iconbtn", `dui-btn--${variant}`, `dui-btn--${size}`, className)}
      aria-label={label}
      title={rest.title ?? label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon name={icon} size={size === "sm" ? 14 : 16} />
    </button>
  );
});

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: Size;
  icon?: IconName;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ size = "md", icon, invalid, className, ...rest }, ref) {
  return (
    <span className={cx("dui-input", `dui-input--${size}`, invalid && "is-invalid", className)}>
      {icon && <Icon name={icon} size={14} className="dui-input__icon" />}
      <input ref={ref} aria-invalid={invalid || undefined} {...rest} />
    </span>
  );
});

export interface SearchInputProps extends Omit<InputProps, "onChange" | "value"> {
  value: string;
  onValueChange(v: string): void;
  /** Shortcut that focuses the field, shown as a hint. */
  shortcut?: string;
  label?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onValueChange, shortcut, label = "Search", placeholder = "Search", className, size = "md", icon: _icon, invalid: _invalid, ...rest },
  ref,
) {
  const local = useRef<HTMLInputElement | null>(null);
  return (
    <span className={cx("dui-input", "dui-search", `dui-input--${size}`, className)}>
      <Icon name="search" size={14} className="dui-input__icon" />
      <input
        ref={(el) => {
          local.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onValueChange("");
          }
        }}
        {...rest}
      />
      {value ? (
        <button type="button" className="dui-search__clear" aria-label="Clear search" onClick={() => (onValueChange(""), local.current?.focus())}>
          <Icon name="x" size={12} />
        </button>
      ) : shortcut ? (
        <Kbd>{shortcut}</Kbd>
      ) : null}
    </span>
  );
});

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: Size;
  options: { value: string; label: string }[];
  label?: string;
}

/** A native select, styled: the most accessible choice for a short list. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ size = "md", options, label, className, ...rest }, ref) {
  return (
    <span className={cx("dui-select", `dui-input--${size}`, className)}>
      <select ref={ref} aria-label={label} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={12} className="dui-select__chev" />
    </span>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  checked: boolean;
  onCheckedChange(v: boolean): void;
  label: ReactNode;
  indeterminate?: boolean;
  hint?: ReactNode;
}

export function Checkbox({ checked, onCheckedChange, label, indeterminate, hint, className, id, ...rest }: CheckboxProps) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <label className={cx("dui-check", className)} htmlFor={cid}>
      <input
        id={cid}
        type="checkbox"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate;
        }}
        onChange={(e) => onCheckedChange(e.target.checked)}
        {...rest}
      />
      <span className="dui-check__box" aria-hidden="true">
        <Icon name={indeterminate ? "minus" : "check"} size={12} />
      </span>
      <span className="dui-check__label">
        {label}
        {hint && <span className="dui-check__hint">{hint}</span>}
      </span>
    </label>
  );
}

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange(v: boolean): void;
  label: ReactNode;
}

export function Switch({ checked, onCheckedChange, label, className, ...rest }: SwitchProps) {
  const id = useId();
  return (
    <span className={cx("dui-switch", className)}>
      <button type="button" role="switch" id={id} aria-checked={checked} className="dui-switch__track" onClick={() => onCheckedChange(!checked)} {...rest}>
        <span className="dui-switch__thumb" />
      </button>
      <label htmlFor={id} className="dui-switch__label">
        {label}
      </label>
    </span>
  );
}

export interface RadioGroupProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; hint?: ReactNode; disabled?: boolean }[];
  onValueChange(v: T): void;
  orientation?: "horizontal" | "vertical";
}

export function RadioGroup<T extends string>({ label, value, options, onValueChange, orientation = "vertical" }: RadioGroupProps<T>) {
  const name = useId();
  return (
    <fieldset className={cx("dui-radios", `dui-radios--${orientation}`)}>
      <legend className="dui-overline">{label}</legend>
      {options.map((o) => (
        <label key={o.value} className={cx("dui-radio", o.disabled && "is-disabled")}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onValueChange(o.value)} />
          <span className="dui-radio__dot" aria-hidden="true" />
          <span>
            {o.label}
            {o.hint && <span className="dui-check__hint">{o.hint}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** A shortcut label, OS-correct (`mod+k` is ⌘K on macOS, Ctrl+K elsewhere). */
export function Kbd({ children, className }: { children: string; className?: string }) {
  const parts = children.split(" ").map((c) => shortcutLabel(c));
  return (
    <span className={cx("dui-kbd-group", className)}>
      {parts.map((p, i) => (
        <kbd key={i} className="dui-kbd">
          {p}
        </kbd>
      ))}
    </span>
  );
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span className="dui-spinner" role={label ? "status" : undefined} aria-label={label} style={{ width: size, height: size }}>
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
        <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export interface ProgressProps {
  /** 0..1, or undefined for indeterminate. */
  value?: number;
  label: string;
  tone?: "accent" | "success" | "warning" | "danger";
}

export function Progress({ value, label, tone = "accent" }: ProgressProps) {
  return (
    <div
      className={cx("dui-progress", `dui-progress--${tone}`, value === undefined && "is-indeterminate")}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === undefined ? undefined : Math.round(value * 100)}
    >
      <span className="dui-progress__bar" style={value === undefined ? undefined : { width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Skeleton({ width, height = 12, lines, className }: { width?: number | string; height?: number; lines?: number; className?: string }) {
  if (lines)
    return (
      <span className={cx("dui-skeleton-lines", className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="dui-skeleton" style={{ height, width: i === lines - 1 ? "62%" : "100%" }} />
        ))}
      </span>
    );
  return <span className={cx("dui-skeleton", className)} aria-hidden="true" style={{ width, height }} />;
}
