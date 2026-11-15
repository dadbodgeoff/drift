import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function ChartFrame({ children, value = 25 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-chart-frame" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
