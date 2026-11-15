import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function CampaignsPage() {
  return (
    <PageShell title="Campaigns">
      <Stat value={1} />
    </PageShell>
  );
}
