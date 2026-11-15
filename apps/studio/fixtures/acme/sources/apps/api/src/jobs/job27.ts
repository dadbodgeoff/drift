import { audit } from "./audit";

export function runJob27() {
  audit({ event: "job27" });
  return 27;
}
