import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function EmptyState({ children, value = 26 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-empty-state" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
