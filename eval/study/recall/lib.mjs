// Real-world recall of Drift's mined rules on the build set (round 11, recall11): pure helpers, no I/O.
//
// The question: of the deviations from a mined rule that maintainers later fixed, how many would `drift check`
// have shown at the commit that introduced them? See eval/study/research/2026-11-09/recall11.md for the method;
// walk.mjs produces the per-repo records, score.mjs aggregates them with the functions below.
//
// Vocabulary
//   key        `<card id> <path>#<symbol>`, the identity `drift check` and drift.lock use for a (card, member) pair.
//   checkpoint one first-parent commit after the snapshot S at which `drift check --format json` ran with every
//              card mined at S accepted (the walk record: violations, plus the holds / exemptions of tracked keys).
//   deviation  a key that violates at a checkpoint and is neither in drift.lock at S (legacy) nor already open.
//   fixed      a later checkpoint has the member holding the rule (`study_holds`): the maintainers brought it into
//              conformance. Exempted (Drift now exempts it) and removed (the member left the role or was deleted)
//              are kept apart and are NOT fixes [STRICT]. Still violating at the last checkpoint: unfixed.

// ---------- commit selection ----------

// The snapshot: the first-parent commit `back` total commits before the head, as near as the history allows.
// `fp` is the first-parent list newest first (fp[0] = head); `countBack(i)` is the number of commits in fp[i]..head.
// Returns the first-parent index of S: the smallest i with countBack(i) >= back, else the oldest available.
export function pickSnapshot(fp, countBack, back = 200) {
  if (!fp.length) return -1;
  let lo = 0;
  let hi = fp.length - 1;
  if (countBack(hi) < back) return hi;
  // countBack is non-decreasing in i: binary search for the first i reaching `back`.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (countBack(mid) >= back) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

// The checkpoints: first-parent commits after S, oldest first, ending at the head. With more than `max` of them,
// every stride-th one is kept, plus the head; `stride` is recorded so the report can say what a window hides.
export function checkpoints(after, max) {
  const n = after.length;
  if (n <= max) return { stride: 1, picked: after.map((_, i) => i) };
  const stride = Math.ceil(n / max);
  const picked = [];
  for (let i = stride - 1; i < n; i += stride) picked.push(i);
  if (picked[picked.length - 1] !== n - 1) picked.push(n - 1);
  return { stride, picked };
}

// The pull request a squash-merge commit names: GitHub's "Subject (#123)".
export function prNumber(subject) {
  const m = /\(#(\d+)\)\s*$/.exec(subject || "");
  return m ? Number(m[1]) : null;
}

// ---------- keys and renames ----------

export function keyOf(id, path, symbol) {
  return `${id} ${path}#${symbol}`;
}

export function splitKey(key) {
  const sp = key.indexOf(" ");
  const id = key.slice(0, sp);
  const rest = key.slice(sp + 1);
  const h = rest.indexOf("#");
  return { id, path: rest.slice(0, h), symbol: rest.slice(h + 1) };
}

// `git diff -M --name-status -z` output between two commits -> [[old, new], ...] renames (R and C>=? only R).
export function parseRenames(z) {
  const parts = z.split("\0");
  const out = [];
  for (let i = 0; i < parts.length; ) {
    const st = parts[i];
    if (!st) {
      i++;
      continue;
    }
    if (st[0] === "R" || st[0] === "C") {
      if (st[0] === "R") out.push([parts[i + 1], parts[i + 2]]);
      i += 3;
    } else i += 2;
  }
  return out;
}

// A key moved along `renames` (old path -> new path); unchanged when its file was not renamed.
export function renameKey(key, renames) {
  if (!renames || !renames.length) return key;
  const k = splitKey(key);
  for (const [a, b] of renames) if (a === k.path) return keyOf(k.id, b, k.symbol);
  return key;
}

// ---------- flags of one violation ----------

// The walk stores each violation as [id, path, symbol, flags]; flags is a string of letters:
//   b baselined (in drift.lock at S), s drift-ignore, u unsure (depends on an unchecked file),
//   n held back by the neighbour gate (gate-on run only).
export function flagsOf(v) {
  return (
    (v.baselined ? "b" : "") + (v.suppressed ? "s" : "") + (v.unsure ? "u" : "") + (v.suppressed_neighbour ? "n" : "")
  );
}

// Whether `drift check` gives the violation as a new warning: not baselined, not drift-ignored, not unsure, and with
// the gate on, not held back (`CheckReport::new_violations`).
export function isNew(flags, gate) {
  if (/[bsu]/.test(flags)) return false;
  return !(gate && flags.includes("n"));
}

// ---------- tracking ----------

// Replays a walk. `lock` is the drift.lock keys at S; `cps` the checkpoints oldest first, each
//   { i, sha, renames: [[old,new]], v: [[id,path,symbol,flags]], holds: [key], exempt: [key], unchecked: [path] }
// (renames are those from the previous checkpoint, or from S for the first).
// Returns { devs, legacy } where each deviation is
//   { key, id, intro: checkpoint index (position in cps), introI: first-parent index, flags (at intro),
//     status: "fixed" | "exempted" | "removed" | "unfixed", end: checkpoint position of the status (or null),
//     keyAtEnd }
// and each legacy entry is the same shape with intro = -1 (in the lock at S).
export function track(lock, cps) {
  const open = new Map(); // current key -> record
  const legacy = new Map(); // current key -> record
  const devs = [];
  const legacyOut = [];
  for (const k of lock) {
    const r = { key: k, id: splitKey(k).id, intro: -1, introI: -1, flags: "b", status: null, end: null, keyAtEnd: k };
    legacy.set(k, r);
    legacyOut.push(r);
  }
  const move = (m, renames) => {
    if (!renames || !renames.length) return m;
    const out = new Map();
    for (const [k, r] of m) {
      const nk = renameKey(k, renames);
      r.keyAtEnd = nk;
      out.set(nk, r);
    }
    return out;
  };
  let o = open;
  let l = legacy;
  cps.forEach((cp, pos) => {
    o = move(o, cp.renames);
    l = move(l, cp.renames);
    const now = new Map();
    for (const [id, path, symbol, flags] of cp.v) now.set(keyOf(id, path, symbol), flags);
    const holds = new Set(cp.holds || []);
    const exempt = new Set(cp.exempt || []);
    const unchecked = new Set(cp.unchecked || []);
    const close = (m) => {
      for (const [k, r] of [...m]) {
        if (now.has(k)) continue;
        if (unchecked.has(splitKey(k).path)) continue; // unknown, not absent
        r.status = holds.has(k) ? "fixed" : exempt.has(k) ? "exempted" : "removed";
        r.end = pos;
        r.keyAtEnd = k;
        m.delete(k);
      }
    };
    close(o);
    close(l);
    for (const [k, flags] of now) {
      if (o.has(k) || l.has(k)) continue;
      if (flags.includes("b")) {
        // In the lock under this path but not tracked (a key that came back): legacy again.
        const r = { key: k, id: splitKey(k).id, intro: -1, introI: -1, flags, status: null, end: null, keyAtEnd: k };
        l.set(k, r);
        legacyOut.push(r);
        continue;
      }
      const r = { key: k, id: splitKey(k).id, intro: pos, introI: cp.i, flags, status: null, end: null, keyAtEnd: k };
      o.set(k, r);
      devs.push(r);
    }
  });
  for (const r of o.values()) r.status = "unfixed";
  for (const r of l.values()) r.status = "unfixed";
  return { devs, legacy: legacyOut };
}

// ---------- the show ladder ----------

// Families and reasons, from the committed tables (crates/drift-mine/data/show-policy.json); `table` is that JSON.
export function familyOfKind(table, ruleKind) {
  const f = table.rule_kinds[ruleKind];
  return f === undefined ? null : f;
}

// Why the F11 show policy hides a suggestion: "hidden_family" (the family is never shown in the language),
// "family_not_admitted" (no family, or below the show bar), "outliers" (more than max_outliers), or null (shown).
export function hideReason(table, card) {
  if (card.tier === "default") return null;
  const fam = familyOfKind(table, card.rule_kind);
  const lang = card.language === "py" ? "py" : "ts";
  if (fam === null || fam === undefined) return "family_not_admitted";
  if ((table.hidden[lang] || []).includes(fam)) return "hidden_family";
  const rec = (table.languages[lang] || {})[fam];
  if (!rec || !rec.admitted) return "family_not_admitted";
  if (card.outliers > table.max_outliers) return "outliers";
  return null;
}

// The ladder of nested arms (each includes the ones before it). `card` carries the census facts at S:
//   inShown     listed by F11's census with the product defaults (the cap and the show policy) and shown_by_default
//   inShownPy   the same, under the Python opt-in (`census --python-proposals`)
//   inPool      listed by F11's census with no cap (--all --max 1000), product Python default
//   inPoolPy    the same, Python opt-in
//   tier        "default" (the candidate tier) | "suggestion"
//   language    "ts" | "py"
//   agents      the census `agents.shown_to_agents` at S
// With `optin` the Python opt-in view is read (inShownPy / inPoolPy) instead of the default.
// Arms:
//   agents     what reaches agents with no person's accept (candidates not shown) [the product]
//   shown      suggestions a person is shown and may accept; the candidate tier counted as not shown [headline]
//   candidate  + the candidate (default) tier, as if a person accepted every candidate
//   pool       + every card F11 mines past the cap
//   all        + the cards the show policy hides (and, without opt-in, Python cards)
export const ARMS = ["agents", "shown", "candidate", "pool", "all"];

export function armOf(card, { optin = false } = {}) {
  const shown = optin ? card.inShownPy : card.inShown;
  const pool = optin ? card.inPoolPy : card.inPool;
  if (shown && card.agents && card.tier !== "default") return "agents";
  if (shown && card.tier !== "default") return "shown";
  if (shown && card.tier === "default") return "candidate";
  if (pool) return "pool";
  return "all";
}

// Whether a card of arm `a` is in the nested arm `upTo`.
export function inArm(a, upTo) {
  return ARMS.indexOf(a) <= ARMS.indexOf(upTo);
}

// The visibility class of a card, for the "where do fixed deviations hide" table.
export function visibilityClass(card, table, { optin = false } = {}) {
  const arm = armOf(card, { optin });
  if (arm === "agents" || arm === "shown") return "shown";
  if (arm === "candidate") return "candidate";
  if (arm === "pool") return card.tier === "default" ? "candidate_capped" : "capped";
  if (card.language === "py" && !optin) return "python_off";
  const why = hideReason(table, card);
  return why ? `hidden:${why}` : "hidden:other";
}

// ---------- aggregation ----------

export function ratio(k, n) {
  return n ? k / n : NaN;
}

// Recall per arm over a list of deviations, each { arm, flags, status }: fixed deviations in the arm that `drift check`
// gave as new at their introducing checkpoint, over all fixed deviations.
export function recallByArm(devs, { gate = false } = {}) {
  const fixed = devs.filter((d) => d.status === "fixed");
  const out = {};
  for (const a of ARMS) {
    const k = fixed.filter((d) => inArm(d.arm, a) && isNew(d.flags, gate)).length;
    out[a] = { k, n: fixed.length };
  }
  return out;
}

// Warnings per arm: deviations given as new at introduction, how many were later fixed, removed, exempted, unfixed.
export function warningsByArm(devs, { gate = false } = {}) {
  const out = {};
  for (const a of ARMS) {
    const w = devs.filter((d) => inArm(d.arm, a) && isNew(d.flags, gate));
    const by = { fixed: 0, removed: 0, exempted: 0, unfixed: 0 };
    for (const d of w) by[d.status]++;
    out[a] = { warnings: w.length, ...by };
  }
  return out;
}

// Group by a function, counting statuses.
export function groupStatus(devs, fn) {
  const m = new Map();
  for (const d of devs) {
    const g = fn(d);
    if (!m.has(g)) m.set(g, { deviations: 0, fixed: 0, removed: 0, exempted: 0, unfixed: 0 });
    const r = m.get(g);
    r.deviations++;
    r[d.status] = (r[d.status] || 0) + 1;
  }
  return Object.fromEntries([...m].sort((a, b) => b[1].fixed - a[1].fixed || String(a[0]).localeCompare(String(b[0]))));
}

// ---------- proposal P1: the show policy before the caps ----------

// F11 applies the per-repo cap (15) and the layering share (ceil(15 x 25%) avoid rules) before the show policy, so a
// card the policy hides still takes a slot (mine.rs `truncate_keeping`, then `mine_families`' retain). P1 applies them
// after: the shown set is the first `max` cards of the uncapped, policy-filtered list (`census --all --max 1000`, by
// rank), with at most ceil(max x share) avoid rules. Returns the ids P1 would list by default.
// P1b (`defaultInFull`): as P1, and the default (candidate) tier is listed in full, outside both caps, as `drift census
// --help` already says it is ("the default tier is always listed in full"); suggestions fill what is left of the 15.
export function shownUnderP1(poolCards, { max = 15, avoidShare = 0.25, defaultInFull = false } = {}) {
  const maxAvoid = Math.max(1, Math.ceil(max * avoidShare));
  const sorted = [...poolCards].sort((a, b) => a.rank - b.rank);
  const out = defaultInFull ? sorted.filter((c) => c.tier === "default").map((c) => c.id) : [];
  let avoids = 0;
  for (const c of sorted) {
    if (defaultInFull && c.tier === "default") continue;
    if (out.length >= max) break;
    if (/^avoids:/.test(c.rule_kind)) {
      if (avoids >= maxAvoid) continue;
      avoids++;
    }
    out.push(c.id);
  }
  return new Set(out);
}
