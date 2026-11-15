import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Toolbar({ children, value = 31 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-toolbar" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
