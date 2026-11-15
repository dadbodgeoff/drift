import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Menu({ children, value = 7 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-menu" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
