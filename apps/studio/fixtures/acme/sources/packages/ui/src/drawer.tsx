import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Drawer({ children, value = 4 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-drawer" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
