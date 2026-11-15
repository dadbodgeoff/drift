import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Radio({ children, value = 14 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-radio" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
