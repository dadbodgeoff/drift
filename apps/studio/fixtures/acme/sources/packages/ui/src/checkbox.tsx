import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Checkbox({ children, value = 12 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-checkbox" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
