import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function AlertsPage() {
  return (
    <PageShell title="Alerts">
      <Stat value={1} />
    </PageShell>
  );
}
