import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Alert({ children, value = 19 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-alert" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
