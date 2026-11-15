import { audit } from "./audit";

export function runJob28() {
  audit({ event: "job28" });
  return 28;
}
