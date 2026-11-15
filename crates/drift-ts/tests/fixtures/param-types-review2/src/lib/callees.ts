import type { AugO, IU, IU2, IU4, IU5, IU6, NotAug, Plain, UA, UU, WithTop } from "./types";
import type { Shadow } from "fakepkg/shadow";
import type { BOpts } from "fakepkg/bundle";
import type { SOpts } from "fakepkg/dflt";
import type { COpts } from "fakepkg/conflict";

export function iu(o: IU) { return o; }
export function iu2(o: IU2) { return o; }
export function iu4(o: IU4) { return o; }
export function iu5(o: IU5) { return o; }
export function iu6(o: IU6) { return o; }
export function uu(o: UU) { return o; }
export function ua(o: UA) { return o; }
export function plain(o: Plain) { return o; }
export function withTop(o: WithTop) { return o; }
export function omitAug(o: Omit<AugO, "a">) { return o; }
export function pickAug(o: Pick<AugO, "b">) { return o; }
export function omitPlain(o: Omit<NotAug, "a">) { return o; }
export function dshadow(o: Shadow) { return o; }
export function dbundle(o: BOpts) { return o; }
export function q9(o: SOpts) { return o; }
export function conflict(o: COpts) { return o; }
export function th(this: void, o: { a: string; b?: number }) { return o; }
export function a9(o: { n(): void; z: number; g?: () => void }) { return o; }
