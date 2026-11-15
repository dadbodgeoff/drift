import { audit } from "./audit";

export function runJob23() {
  audit({ event: "job23" });
  return 23;
}
