import { audit } from "./audit";

export function runJob20() {
  audit({ event: "job20" });
  return 20;
}
