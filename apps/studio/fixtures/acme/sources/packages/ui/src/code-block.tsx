import type { ReactNode } from "react";
import { formatNumber } from "@acme/utils";

export function CodeBlock({ children, value = 28 }: { children?: ReactNode; value?: number }) {
  return (
    <div className="acme-code-block" data-value={formatNumber(value)}>
      {children}
    </div>
  );
}
