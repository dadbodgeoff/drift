import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Switch({ children, value = 13 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-switch" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
