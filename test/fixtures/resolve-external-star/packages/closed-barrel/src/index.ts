// A CLOSED export chain: every star target is local and resolvable, so the engine can see the
// complete export set, and a symbol found nowhere in it is provably absent.
export const CLOSED_BARREL_VERSION = "1";

export * from "./local";
