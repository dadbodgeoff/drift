import { audit } from "./audit";

export function runJob17() {
  audit({ event: "job17" });
  return 17;
}
