import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Toast({ children, value = 18 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-toast" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
