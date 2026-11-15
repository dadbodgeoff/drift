import { audit } from "./audit";

export function runJob48() {
  audit({ actor: "cron" } as never);
  return 48;
}
