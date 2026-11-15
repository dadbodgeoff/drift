import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Breadcrumbs({ children, value = 20 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-breadcrumbs" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
