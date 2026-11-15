import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Progress({ children, value = 22 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-progress" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
