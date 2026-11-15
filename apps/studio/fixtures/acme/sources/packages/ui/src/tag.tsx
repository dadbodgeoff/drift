import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Tag({ children, value = 30 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-tag" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
