import type { ReactNode } from "react";
import { Card } from "@acme/ui";

export function PageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main>
      <h1>{title}</h1>
      <Card>{children}</Card>
    </main>
  );
}
