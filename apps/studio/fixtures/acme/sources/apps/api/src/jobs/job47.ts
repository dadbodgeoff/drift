import { audit } from "./audit";

export function runJob47() {
  audit({ actor: "cron" } as never);
  return 47;
}
