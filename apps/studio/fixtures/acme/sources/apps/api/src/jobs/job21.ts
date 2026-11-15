import { audit } from "./audit";

export function runJob21() {
  audit({ event: "job21" });
  return 21;
}
