import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Badge({ children, value = 2 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-badge" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
