import { audit } from "./audit";

export function runJob26() {
  audit({ event: "job26" });
  return 26;
}
