import { mappedUndef, gdef, gdef2, gdef3, getter, setter, ifaceGetter, omitOpen, extAlias, nsf, shadowed, renamed, pickPartial, partialPick, reqPickPartial, importEq, augmented, dd } from "../lib/callees";
import { shadowFn } from "../lib/barrel";
import legacy from "../lib/legacy";
import { pf, pcf } from "fakepkg";
export function run() {
  gdef({ a: undefined, b: "x" });
  gdef2({ a: undefined, b: "x" });
  gdef3({ a: "x", b: undefined });
  getter({ name: "x", size: 1 });
  setter({ v: "x", w: 1 });
  ifaceGetter({ label: "x", n: 1 });
  omitOpen({ b: 1 });
  extAlias({ a: "x", z: 1, c: "y" });
  nsf({ a: "x", b: "y", c: "z", d: "w" });
  shadowed({ k: "x", j: "y" });
  shadowFn({ k: "x" });
  renamed({ a: "x", b: "y", c: undefined, d: "w" });
  pickPartial({ a: "x", z: 1 });
  partialPick({ a: "x" });
  reqPickPartial({ a: "x", b: "y" });
  importEq({ a: "x", b: 1 });
  augmented({ a: "x", c: undefined, d: "w" });
  dd({ a: 1, b: "x" });
  mappedUndef({ r: undefined, p: undefined, q: undefined, s: undefined });
  legacy({ a: "x", b: "y" });
  pf({ a: "x", g: undefined, m: undefined, extra: "e" });
  pcf({ label: "x", size: 1 });
}
