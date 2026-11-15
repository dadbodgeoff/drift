import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function AnalyticsPage() {
  return (
    <PageShell title="Analytics">
      <Stat value={1} />
    </PageShell>
  );
}
