import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function EventsPage() {
  return (
    <PageShell title="Events">
      <Stat value={1} />
    </PageShell>
  );
}
