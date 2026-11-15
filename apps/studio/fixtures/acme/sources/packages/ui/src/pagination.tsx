import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Pagination({ children, value = 21 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-pagination" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
