import { audit } from "./audit";

export function runJob38() {
  audit({ event: "job38" });
  return 38;
}
