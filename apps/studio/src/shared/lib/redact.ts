// Redaction of obvious secrets in transcript text. Transcripts can contain
// tokens an agent read from .env files or printed by a command; the Sessions
// view hides them by default and offers a reveal toggle.

interface Pattern {
  name: string;
  re: RegExp;
  /** Replace only this capture group (keeps e.g. the variable name). */
  group?: number;
}

const PATTERNS: Pattern[] = [
  { name: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "AWS key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})\b/g },
  { name: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { name: "API key", re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: "Stripe key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: "URL password", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]{3,})@/gi, group: 1 },
  {
    name: "secret value",
    // Also JSON and YAML forms: `"DB_PASSWORD": "…"`.
    re: /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*["']?\s*[=:]\s*["']?([^\s"'`]{8,})/gi,
    group: 1,
  },
];

export interface Redacted {
  text: string;
  count: number;
}

export function redact(text: string): Redacted {
  let count = 0;
  let out = text;
  for (const p of PATTERNS) {
    out = out.replace(p.re, (m, ...groups) => {
      if (m.startsWith("[redacted")) return m;
      count++;
      const label = `[redacted ${p.name}]`;
      // A match that spans lines keeps its newlines (each line becomes the label),
      // so line-based views such as diffs keep their shape.
      if (p.group === undefined) return m.includes("\n") ? m.replace(/[^\n]+/g, label) : label;
      const g = groups[p.group - 1] as string | undefined;
      if (g?.startsWith("[redacted")) {
        count--;
        return m;
      }
      return g ? m.replace(g, label) : label;
    });
  }
  return { text: out, count };
}

/**
 * Redact lines that belong together (a diff hunk) as one text, so a secret that
 * spans lines (a PEM key) is caught; the result has the same number of lines.
 */
export function redactLines(lines: string[]): { lines: string[]; count: number } {
  const r = redact(lines.join("\n"));
  const out = r.text.split("\n");
  return out.length === lines.length ? { lines: out, count: r.count } : { lines: lines.map((l) => redact(l).text), count: r.count };
}
