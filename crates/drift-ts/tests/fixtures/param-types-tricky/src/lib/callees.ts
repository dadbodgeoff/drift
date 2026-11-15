import type { Opts, ExtA, GOpts, GA, G2, Open, Cfg, SetOnly, IG, IE, BaseA } from "./types";
import type * as T from "./types";
import type { Shadow, RenamedOpts } from "./barrel";
export function gdef(o: GOpts) { return o; }
export function gdef2(o: GA) { return o; }
export function gdef3(o: G2<string>) { return o; }
export function getter(o: Cfg) { return o; }
export function setter(o: SetOnly) { return o; }
export function ifaceGetter(o: IG) { return o; }
export function omitOpen(o: Omit<Open, "a">) { return o; }
export function extAlias(o: ExtA) { return o; }
export function nsf(o: T.Opts) { return o; }
export function shadowed(o: Shadow) { return o; }
export function renamed(o: RenamedOpts) { return o; }
export function pickPartial(o: Pick<Partial<BaseA>, "a" | "z">) { return o; }
export function partialPick(o: Partial<Pick<Opts, "a">>) { return o; }
export function reqPickPartial(o: Required<Pick<Partial<Opts>, "a" | "b">>) { return o; }
export function importEq(o: IE) { return o; }
export function augmented(o: Opts) { return o; }
export function dd({ a = 1 }: { a: number; b: string }) { return a; }
type MaybeOpts = Opts | undefined;
export function mappedUndef(o: { r: Readonly<string | undefined>; p: Partial<Opts | undefined>; q: Readonly<MaybeOpts>; s: Pick<MaybeOpts, never> }) { return o; }
