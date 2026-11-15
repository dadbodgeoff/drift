import { audit } from "./audit";

export function runJob13() {
  audit({ event: "job13" });
  return 13;
}
