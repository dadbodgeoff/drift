import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Select({ children, value = 11 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-select" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
