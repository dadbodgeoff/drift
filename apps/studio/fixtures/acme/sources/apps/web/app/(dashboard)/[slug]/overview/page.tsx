import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function OverviewPage() {
  return (
    <PageShell title="Overview">
      <Stat value={1} />
    </PageShell>
  );
}
