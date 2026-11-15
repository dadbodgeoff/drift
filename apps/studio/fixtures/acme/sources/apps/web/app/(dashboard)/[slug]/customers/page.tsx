import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function CustomersPage() {
  return (
    <PageShell title="Customers">
      <Stat value={1} />
    </PageShell>
  );
}
