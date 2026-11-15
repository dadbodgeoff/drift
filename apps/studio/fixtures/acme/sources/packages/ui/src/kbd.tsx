import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Kbd({ children, value = 27 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-kbd" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
