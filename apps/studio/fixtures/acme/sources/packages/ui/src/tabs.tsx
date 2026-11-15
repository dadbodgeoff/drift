import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Tabs({ children, value = 8 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-tabs" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
