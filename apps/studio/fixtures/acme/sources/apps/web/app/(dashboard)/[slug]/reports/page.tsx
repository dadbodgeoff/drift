import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function ReportsPage() {
  return (
    <PageShell title="Reports">
      <Stat value={1} />
    </PageShell>
  );
}
