import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Skeleton({ children, value = 17 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-skeleton" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
