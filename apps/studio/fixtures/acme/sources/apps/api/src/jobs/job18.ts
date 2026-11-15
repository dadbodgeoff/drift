import { audit } from "./audit";

export function runJob18() {
  audit({ event: "job18" });
  return 18;
}
