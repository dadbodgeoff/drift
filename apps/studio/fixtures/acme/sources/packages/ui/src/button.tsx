import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Button({ children, value = 0 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-button" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
