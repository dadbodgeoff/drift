import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Dialog({ children, value = 3 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-dialog" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
