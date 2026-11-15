import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Avatar({ children, value = 15 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-avatar" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
