import type { ReactNode } from "react";

export function EmailLayout({ children }: { children: ReactNode }) {
  return <html><body>{children}</body></html>;
}
