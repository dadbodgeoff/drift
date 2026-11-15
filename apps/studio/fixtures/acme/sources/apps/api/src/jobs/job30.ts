import { audit } from "./audit";

export function runJob30() {
  audit({ event: "job30" });
  return 30;
}
