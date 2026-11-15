import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function Slider({ children, value = 23 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-slider" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
