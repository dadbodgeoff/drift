// Small TypeScript/JavaScript/JSX and Python tokenizers for display. It produces plain
// token objects; the code viewer renders each as a text node inside a <span>,
// so repository content is always escaped by React and never parsed as HTML.

export type TokenKind =
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "type"
  | "function"
  | "decorator"
  | "tag"
  | "punct"
  | "plain";

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set(
  (
    "abstract as async await break case catch class const continue debugger declare default delete do else enum export extends " +
    "false finally for from function get if implements import in infer instanceof interface is keyof let namespace new null of " +
    "package private protected public readonly return satisfies set static super switch this throw true try type typeof undefined " +
    "var void while with yield"
  ).split(" "),
);

const PY_KEYWORDS = new Set(
  (
    "False None True and as assert async await break class continue def del elif else except finally for from global if import " +
    "in is lambda match nonlocal not or pass raise return try type while with yield case self cls"
  ).split(" "),
);

/** Languages the highlighter knows; anything else is shown as plain text. */
export type CodeLang = "ts" | "py" | "plain";

/** Pick a highlighter from a path or a Drift `lang` tag (`ts`, `tsx`, `js`, `py`, ...). */
export function langOf(pathOrTag: string): CodeLang {
  const ext = pathOrTag.includes(".") ? pathOrTag.slice(pathOrTag.lastIndexOf(".") + 1).toLowerCase() : pathOrTag.toLowerCase();
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"].includes(ext)) return "ts";
  if (["py", "pyi"].includes(ext)) return "py";
  return "plain";
}

const IDENT = /[A-Za-z_$][\w$]*/y;
const NUMBER = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)n?/y;

/** Tokenize a whole file (comments and template strings may span lines). */
export function tokenize(src: string, lang: CodeLang = "ts"): Token[] {
  if (lang === "plain") return src ? [{ kind: "plain", text: src }] : [];
  if (lang === "py") return tokenizePython(src);
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  const push = (kind: TokenKind, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && (kind === "plain" || kind === "punct")) last.text += text;
    else out.push({ kind, text });
  };
  let prevSignificant = "";
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const j = src.indexOf("\n", i);
      const end = j < 0 ? n : j;
      push("comment", src.slice(i, end));
      i = end;
      continue;
    }
    if (c === "/" && d === "*") {
      const j = src.indexOf("*/", i + 2);
      const end = j < 0 ? n : j + 2;
      push("comment", src.slice(i, end));
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") j++;
        else if (c !== "`" && src[j] === "\n") break;
        j++;
      }
      const end = Math.min(j + 1, n);
      push("string", src.slice(i, end));
      i = end;
      prevSignificant = "i";
      continue;
    }
    if (/\s/.test(c)) {
      let j = i;
      while (j < n && /\s/.test(src[j])) j++;
      push("plain", src.slice(i, j));
      i = j;
      continue;
    }
    if (/\d/.test(c)) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(src);
      if (m) {
        push("number", m[0]);
        i += m[0].length;
        prevSignificant = "i";
        continue;
      }
    }
    if (c === "@" && /[A-Za-z_$]/.test(d ?? "")) {
      IDENT.lastIndex = i + 1;
      const m = IDENT.exec(src)!;
      push("decorator", "@" + m[0]);
      i += 1 + m[0].length;
      prevSignificant = "i";
      continue;
    }
    if (c === "<" && /[A-Za-z/]/.test(d ?? "") && !/[\w)\]$]/.test(prevSignificant)) {
      // JSX tag: `<Name` or `</Name`
      let j = i + 1;
      if (src[j] === "/") j++;
      IDENT.lastIndex = j;
      const m = IDENT.exec(src);
      if (m) {
        push("punct", src.slice(i, j));
        let name = m[0];
        let k = j + name.length;
        while (src[k] === "." && /[A-Za-z_$]/.test(src[k + 1] ?? "")) {
          IDENT.lastIndex = k + 1;
          const more = IDENT.exec(src);
          if (!more) break;
          name += "." + more[0];
          k += 1 + more[0].length;
        }
        push("tag", name);
        i = k;
        prevSignificant = "<";
        continue;
      }
    }
    IDENT.lastIndex = i;
    const id = IDENT.exec(src);
    if (id) {
      const w = id[0];
      let kind: TokenKind = "plain";
      if (KEYWORDS.has(w)) kind = "keyword";
      else {
        let k = i + w.length;
        while (src[k] === " ") k++;
        if (src[k] === "(" || (src[k] === "<" && /^[A-Za-z]/.test(src[k + 1] ?? "") && /^[a-z]/.test(w))) kind = "function";
        else if (/^[A-Z]/.test(w)) kind = "type";
      }
      push(kind, w);
      i += w.length;
      prevSignificant = kind === "keyword" && w !== "this" && w !== "true" && w !== "false" && w !== "null" ? "=" : "i";
      continue;
    }
    push("punct", c);
    prevSignificant = c;
    i++;
  }
  return out;
}

function tokenizePython(src: string): Token[] {
  const out: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && (kind === "plain" || kind === "punct")) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "#") {
      const j = src.indexOf("\n", i);
      const end = j < 0 ? n : j;
      push("comment", src.slice(i, end));
      i = end;
      continue;
    }
    const pre = /^[rRbBuUfF]{0,2}(?=["'])/.exec(src.slice(i, i + 3))?.[0] ?? null;
    if (pre !== null && (src[i + pre.length] === '"' || src[i + pre.length] === "'")) {
      const q = src[i + pre.length];
      const triple = src.startsWith(q.repeat(3), i + pre.length);
      const open = triple ? q.repeat(3) : q;
      let j = i + pre.length + open.length;
      while (j < n && !src.startsWith(open, j)) {
        if (src[j] === "\\") j++;
        else if (!triple && src[j] === "\n") break;
        j++;
      }
      const end = Math.min(n, j + open.length);
      push("string", src.slice(i, end));
      i = end;
      continue;
    }
    if (/\s/.test(c)) {
      let j = i;
      while (j < n && /\s/.test(src[j])) j++;
      push("plain", src.slice(i, j));
      i = j;
      continue;
    }
    if (/\d/.test(c)) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(src);
      if (m) {
        push("number", m[0]);
        i += m[0].length;
        continue;
      }
    }
    if (c === "@" && /[A-Za-z_]/.test(src[i + 1] ?? "")) {
      const m = /@[\w.]+/y;
      m.lastIndex = i;
      const d = m.exec(src)![0];
      push("decorator", d);
      i += d.length;
      continue;
    }
    IDENT.lastIndex = i;
    const id = IDENT.exec(src);
    if (id) {
      const w = id[0];
      let kind: TokenKind = "plain";
      if (PY_KEYWORDS.has(w)) kind = "keyword";
      else if (src[i + w.length] === "(") kind = "function";
      else if (/^[A-Z]/.test(w)) kind = "type";
      push(kind, w);
      i += w.length;
      continue;
    }
    push("punct", c);
    i++;
  }
  return out;
}

/** Split tokens into lines (a token spanning lines is cut at each newline). */
export function tokenLines(src: string, lang: CodeLang = "ts"): Token[][] {
  const lines: Token[][] = [[]];
  for (const t of tokenize(src, lang)) {
    const parts = t.text.split("\n");
    parts.forEach((p, k) => {
      if (k > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ kind: t.kind, text: p });
    });
  }
  return lines;
}

/** Highlight a single line of code with no surrounding context (diff lines). */
export function tokenizeLine(line: string, lang: CodeLang = "ts"): Token[] {
  return tokenLines(line, lang)[0] ?? [];
}
