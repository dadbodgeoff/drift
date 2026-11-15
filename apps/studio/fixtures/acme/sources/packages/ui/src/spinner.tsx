import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Spinner({ children, value = 16 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-spinner" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
