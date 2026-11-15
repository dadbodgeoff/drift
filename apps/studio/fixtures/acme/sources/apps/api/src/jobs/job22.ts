import { audit } from "./audit";

export function runJob22() {
  audit({ event: "job22" });
  return 22;
}
