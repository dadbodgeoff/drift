import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Tooltip({ children, value = 5 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-tooltip" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
