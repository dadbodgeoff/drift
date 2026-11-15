import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Input({ children, value = 10 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-input" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
