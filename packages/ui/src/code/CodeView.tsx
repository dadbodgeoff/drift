// Code and diff views. Text is tokenized into plain token objects and every
// token is rendered as a React text node, so repository content is always
// escaped and never parsed as HTML.
import { type ReactNode, memo, useEffect, useMemo, useRef } from "react";
import { Icon, type IconName } from "../foundations/Icon";
import { cx, useVirtualRows } from "../foundations/hooks";
import { type CodeLang, type Token, tokenLines, tokenizeLine } from "./tokenize";

const LINE_H = 20;
/** Files longer than this render only the visible lines. */
const VIRTUALIZE_AFTER = 2500;

const Line = memo(function Line({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map((t, i) =>
        t.kind === "plain" ? (
          t.text
        ) : (
          <span key={i} className={`tok-${t.kind}`}>
            {t.text}
          </span>
        ),
      )}
    </>
  );
});

export interface CodeMarker {
  line: number;
  tone: "danger" | "warning" | "info" | "accent" | "success";
  label: string;
  icon?: IconName;
}

export interface CodeViewProps {
  text: string;
  lang: CodeLang;
  /** 1-based line to highlight and scroll to. */
  focusLine?: number | null;
  markers?: CodeMarker[];
  label: string;
  height?: number | string;
  wrap?: boolean;
}

export function CodeView({ text, lang, focusLine, markers = [], label, height = "100%", wrap = false }: CodeViewProps) {
  const lines = useMemo(() => tokenLines(text.replace(/\r\n/g, "\n"), lang), [text, lang]);
  const byLine = useMemo(() => {
    const m = new Map<number, CodeMarker[]>();
    for (const mk of markers) m.set(mk.line, [...(m.get(mk.line) ?? []), mk]);
    return m;
  }, [markers]);
  const scroll = useRef<HTMLDivElement | null>(null);
  const virtual = lines.length > VIRTUALIZE_AFTER;
  const v = useVirtualRows({ count: virtual ? lines.length : 0, rowHeight: LINE_H, scrollRef: scroll, overscan: 30 });
  const gutterCh = String(lines.length).length;

  useEffect(() => {
    if (!focusLine || !scroll.current) return;
    const top = (focusLine - 1) * LINE_H - scroll.current.clientHeight / 3;
    scroll.current.scrollTop = Math.max(0, top);
  }, [focusLine, text]);

  const row = (i: number, style?: React.CSSProperties) => {
    const n = i + 1;
    const mk = byLine.get(n);
    return (
      <div key={i} className={cx("dui-code__line", n === focusLine && "is-focus", mk && `has-marker is-${mk[0].tone}`)} style={style} data-line={n}>
        <span className="dui-code__gutter" aria-hidden="true">
          <span className="dui-code__marker">{mk && <Icon name={mk[0].icon ?? "dot"} size={12} />}</span>
          <span className="dui-code__num" style={{ width: `${gutterCh}ch` }}>
            {n}
          </span>
        </span>
        <span className="dui-code__text">
          <Line tokens={lines[i]} />
          {mk && <span className="dui-sr"> ({mk.map((m) => m.label).join("; ")})</span>}
        </span>
      </div>
    );
  };

  const body: ReactNode[] = [];
  if (virtual) for (let i = v.start; i < Math.min(v.end, lines.length); i++) body.push(row(i, { position: "absolute", top: i * LINE_H, left: 0, right: 0 }));
  else for (let i = 0; i < lines.length; i++) body.push(row(i));

  return (
    <div ref={scroll} className={cx("dui-code", wrap && "is-wrap")} style={{ height }} role="region" aria-label={label} tabIndex={0}>
      <pre className="dui-code__pre" style={virtual ? { height: lines.length * LINE_H, position: "relative" } : undefined}>
        <code>{body}</code>
      </pre>
    </div>
  );
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

export interface DiffViewProps {
  hunks: DiffHunk[];
  lang: CodeLang;
  label: string;
  /** A new file: every line is an addition. */
  created?: boolean;
  maxLines?: number;
}

export function DiffView({ hunks, lang, label, created, maxLines = 400 }: DiffViewProps) {
  let shown = 0;
  const adds = hunks.reduce((n, h) => n + h.lines.filter((l) => l.startsWith("+")).length, 0);
  const dels = hunks.reduce((n, h) => n + h.lines.filter((l) => l.startsWith("-")).length, 0);
  return (
    <div className="dui-diff" role="region" aria-label={label} tabIndex={0}>
      <div className="dui-diff__stats">
        {created && <span className="dui-diff__new">new file</span>}
        <span className="dui-diff__add">+{adds}</span>
        <span className="dui-diff__del">−{dels}</span>
      </div>
      <pre className="dui-code__pre">
        <code>
          {hunks.map((h, hi) => {
            let o = h.oldStart || 1;
            let n = h.newStart || 1;
            return (
              <div key={hi} className="dui-diff__hunk">
                {hi > 0 || h.oldStart > 1 ? (
                  <div className="dui-diff__sep" aria-hidden="true">
                    @@ −{h.oldStart} +{h.newStart} @@
                  </div>
                ) : null}
                {h.lines.map((l, li) => {
                  if (shown++ >= maxLines) return li === 0 ? <div key="more" className="dui-diff__sep">… more lines not shown</div> : null;
                  const kind = l[0] === "+" ? "add" : l[0] === "-" ? "del" : "ctx";
                  const on = kind === "add" ? null : o++;
                  const nn = kind === "del" ? null : n++;
                  return (
                    <div key={li} className={cx("dui-diff__line", `is-${kind}`)}>
                      <span className="dui-diff__num" aria-hidden="true">
                        {on ?? ""}
                      </span>
                      <span className="dui-diff__num" aria-hidden="true">
                        {nn ?? ""}
                      </span>
                      <span className="dui-diff__sign" aria-hidden="true">
                        {kind === "add" ? "+" : kind === "del" ? "−" : " "}
                      </span>
                      <span className="dui-code__text">
                        <span className="dui-sr">{kind === "add" ? "added: " : kind === "del" ? "removed: " : ""}</span>
                        <Line tokens={tokenizeLine(l.slice(1), lang)} />
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
