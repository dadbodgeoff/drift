import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";
import { currentPlan } from "../../../apps/web/lib/plan";

export function Stat({ children, value = 24 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-stat" data-value={formatNumber(value)}>
      {currentPlan()}{children}
    </div>
  );
}
