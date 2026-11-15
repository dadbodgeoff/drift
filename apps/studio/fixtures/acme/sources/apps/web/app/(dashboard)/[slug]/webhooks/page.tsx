import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function WebhooksPage() {
  return (
    <PageShell title="Webhooks">
      <Stat value={1} />
    </PageShell>
  );
}
