import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function BillingPage() {
  return (
    <PageShell title="Billing">
      <Stat value={1} />
    </PageShell>
  );
}
