import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Table({ children, value = 9 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-table" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
