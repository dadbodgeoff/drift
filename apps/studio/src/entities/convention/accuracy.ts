// What the beta says about accuracy (docs/ACCURACY.md, #140), as the Studio repeats it: the out-of-sample figures
// first, each with its in-sample counterpart named as such. A unit test (tests/unit/accuracy.test.ts) keeps every
// figure here equal to the one in docs/ACCURACY.md's "At a glance" table.

export interface Figure {
  /** Accepted cards over cards shown. */
  k: number;
  n: number;
  /** Wilson 95% interval, as the doc prints it (percent). */
  lo: number;
  hi: number;
}

export const ACCURACY = {
  doc: "docs/ACCURACY.md",
  /** TypeScript/JavaScript default tier (call wrappers and layering), out of sample: pooled over three blind and held-out pools. */
  defaultTier: { k: 7, n: 15, lo: 24.8, hi: 69.9 } satisfies Figure,
  /** TypeScript/JavaScript suggestions after the round-10 show policy, out of sample (one blind pool). */
  suggestions: { k: 6, n: 7, lo: 48.7, hi: 97.4 } satisfies Figure,
  /** TypeScript/JavaScript, everything shown after the show policy, out of sample. */
  shown: { k: 7, n: 12, lo: 32.0, hi: 80.7 } satisfies Figure,
  /** The same, in sample (the build set the fixes were developed on): percent. */
  shownInSample: 93.5,
  /** The release gate (decision D1): a language's default tier blocks without a person's choice only at this, held out. */
  gate: 95,
} as const;

export const pctOf = (f: Figure) => Math.round((100 * f.k) / f.n);

/** The beta's one line on block candidates (README "Review every proposal", docs/ACCURACY.md). */
export const REVIEW_FIRST_TEXT = `On repositories Drift was not tuned on, about half of the default-tier cards were right (${ACCURACY.defaultTier.k} of ${ACCURACY.defaultTier.n}), below the ${ACCURACY.gate}% release gate: read each one's outliers before you accept it.`;
