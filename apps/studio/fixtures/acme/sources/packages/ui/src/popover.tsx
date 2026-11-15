import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Popover({ children, value = 6 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-popover" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
