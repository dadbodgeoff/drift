import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function DomainsPage() {
  return (
    <PageShell title="Domains">
      <Stat value={1} />
    </PageShell>
  );
}
