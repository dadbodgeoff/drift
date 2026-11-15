import df, { pf } from "fakepkg";
import { bf } from "fakepkg/bundle";
import {
  a9,
  conflict,
  dbundle,
  dshadow,
  iu,
  iu2,
  iu4,
  iu5,
  iu6,
  omitAug,
  omitPlain,
  pickAug,
  plain,
  q9,
  th,
  ua,
  uu,
  withTop,
} from "../lib/callees";

export function run() {
  iu({ a: undefined, z: 1 });
  iu2({ a: undefined, z: 1 });
  iu4({ a: undefined, z: 1 });
  iu5({ a: undefined, z: 1 });
  iu6({ a: undefined, z: 1 });
  uu({ a: undefined, z: 1 });
  ua({ a: undefined, z: 1 });
  plain({ a: 1, b: 2, z: 1 });
  withTop({ a: "", z: 1 });
  omitAug({ b: 1 });
  pickAug({ b: 1 });
  omitPlain({ b: 1 });
  dshadow({ k: "", j: "" });
  dbundle({ k: "", j: "" });
  q9({ k: "", j: "" });
  conflict({ k: "" });
  th({ a: "", b: 1 });
  a9({ n() {}, z: 1, g: () => {} });
  df({ a: "", b: 1 });
  pf({ a: "", m: undefined });
  bf({ k: "", j: "" });
}
