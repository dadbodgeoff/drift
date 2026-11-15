import { audit } from "./audit";

export function runJob24() {
  audit({ event: "job24" });
  return 24;
}
