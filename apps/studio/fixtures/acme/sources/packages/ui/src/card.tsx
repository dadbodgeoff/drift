import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Card({ children, value = 1 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-card" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
