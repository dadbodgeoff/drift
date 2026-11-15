// Markdown for sharing (PRs, chat). Repository text is only ever placed in
// code spans or fences, never as live Markdown, so it cannot inject links,
// images or formatting.

/** Inline code span that survives any backticks in `s` (newlines become spaces). */
export function mdCode(s: string): string {
  const t = s.replace(/\r?\n/g, " ");
  const longest = Math.max(0, ...[...t.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = t.startsWith("`") || t.endsWith("`") || t.startsWith(" ") ? " " : "";
  return `${fence}${pad}${t}${pad}${fence}`;
}

/** Fenced block that survives any fences in `s`. */
export function mdFence(s: string, lang = ""): string {
  const longest = Math.max(2, ...[...s.matchAll(/`{3,}/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${lang}\n${s.replace(/\n$/, "")}\n${fence}`;
}

/** Plain prose from our own UI (escapes Markdown punctuation). */
export function mdText(s: string): string {
  return s.replace(/([\\`*_{}[\]()#+!|<>~])/g, "\\$1");
}

export function mdTable(head: string[], rows: string[][]): string {
  const cell = (c: string) => c.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  return [`| ${head.map(cell).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}
