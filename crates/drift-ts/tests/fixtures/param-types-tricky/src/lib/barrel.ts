interface Shadow { k: string; j: string }
function shadowFn(o: { k: string }) { return o; }
export * from "./shadow-src";
export type { Opts as RenamedOpts } from "./types";
export const _unused = [shadowFn as unknown as Shadow];
