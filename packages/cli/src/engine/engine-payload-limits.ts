/**
 * T-01: the largest engine payload onboarding will accept, and the measurements that fix it.
 *
 * `infer-candidates` sends the whole graph and the whole fact set BACK to the engine as a single
 * `JSON.stringify` (engine-candidates.ts:21). That string is bounded by Node's `MAX_STRING_LENGTH`
 * (536,870,888 on v25.2.1) and by nothing Drift controls, so a large enough repo dies with
 * `Invalid string length` - exit 1, a partial database on disk, and every later command exiting 1
 * against it. This gate turns that into a refusal that names the number.
 *
 * WHAT IS MEASURED. The gate counts bytes of the engine's JSONL stream as they arrive
 * (`collectScanDataFromRust`). That is the only size known before the request is built, and it is
 * a good proxy: the request carries the same graph, snapshots and facts the stream delivered,
 * minus the per-line event framing.
 *
 * THE RATIO, measured at d2517b9 by instrumenting `JSON.stringify` on a papermark onboarding:
 *
 *   stream in   107,938,762 bytes
 *   stringify   105,027,953 chars, at inferConventionCandidatesFromEngine  ->  0.973x
 *
 * The request is slightly SMALLER than the stream, because JSONL repeats `schema_version` and an
 * event wrapper on every line and the request does not. A second, smaller stringify builds the
 * graph artifact; the `infer-candidates` one is the binding constraint.
 *
 * A note for anyone reconciling this against the T-01 plan document: its table reports papermark
 * at "15 MB engine payload -> 102 MB infer-candidates string, 6.8x". The 102 MB matches the
 * measurement above almost exactly, and so does its cal.com figure (388 MB, against a 395.5 MiB
 * stream measured here). Its "engine payload" column is some other, smaller quantity - not the
 * stream. Against the stream the multiplier is ~1, and a ceiling derived from 6.8-7.8x would have
 * refused six of the seven corpus repos that onboard today.
 *
 * WHERE THE THRESHOLD SITS. Bracketed by two measurements, not chosen:
 *   - above cal.com's 395.5 MiB, the largest stream that onboards today (+21%);
 *   - below the stream whose request would exceed MAX_STRING_LENGTH. At the conservative ratio
 *     bound of 1.0 that wall is 512 MiB; at the ratio actually observed it is ~526 MiB.
 *
 * At 480 MiB the request lands at ~91% of MAX_STRING_LENGTH on observed behaviour, and the gate
 * only fails to catch a repo whose ratio exceeds 1.067 - against 0.973 measured.
 *
 * Both edges are asserted in `engine-payload-gate.test.ts`. If a new measurement moves either one,
 * that test fails rather than this comment going quietly stale.
 *
 * This is a stopgap that makes the failure honest, not a fix. It leaves only a narrow band between
 * the corpus and the wall, which is the real argument for T-02: remove the re-serialization and
 * the wall goes away rather than being negotiated with.
 */

const MEBIBYTE = 1024 * 1024;

/** Engine payload bytes above which onboarding refuses rather than attempting serialization. */
export const ENGINE_PAYLOAD_MAX_BYTES = 480 * MEBIBYTE;

/**
 * Conservative upper bound on `infer-candidates` string length per stream byte.
 *
 * 1.0 rather than the 0.973 measured: the gate's guarantee is that nothing which passes it can
 * then throw, and rounding the bound down would spend the safety margin on optimism. Two
 * independent measurements sit below it (papermark 0.973, cal.com ~0.98).
 */
export const ENGINE_PAYLOAD_STRINGIFY_RATIO_BOUND = 1.0;

/**
 * Engine payload streams measured on corpus repos that onboard successfully today, at d2517b9.
 *
 *   drift-engine scan-repo <root> --format jsonl --repo-id x --scan-id y | wc -c
 *
 * The gate must stay above every one of these, or it breaks a repo that works.
 */
export const MEASURED_CORPUS_ENGINE_PAYLOAD_BYTES: Record<string, number> = {
  taxonomy: 3_372_157,
  papermark: 107_938_762,
  midday: 186_862_706,
  openstatus: 208_132_773,
  dub: 270_740_593,
  formbricks: 371_381_603,
  "cal.com": 414_743_834
};

export function enginePayloadExceedsCeiling(payloadBytes: number): boolean {
  return payloadBytes > ENGINE_PAYLOAD_MAX_BYTES;
}

/** Whole mebibytes, for messages. Rounded, because a byte count is noise at this scale. */
export function enginePayloadMegabytes(payloadBytes: number): number {
  return Math.round(payloadBytes / MEBIBYTE);
}
