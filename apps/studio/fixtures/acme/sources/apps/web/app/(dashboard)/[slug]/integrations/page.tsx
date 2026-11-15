import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function IntegrationsPage() {
  return (
    <PageShell title="Integrations">
      <Stat value={1} />
    </PageShell>
  );
}
