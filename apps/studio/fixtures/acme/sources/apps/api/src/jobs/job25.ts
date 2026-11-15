import { audit } from "./audit";

export function runJob25() {
  audit({ event: "job25" });
  return 25;
}
