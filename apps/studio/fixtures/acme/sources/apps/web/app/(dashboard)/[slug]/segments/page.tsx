import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function SegmentsPage() {
  return (
    <PageShell title="Segments">
      <Stat value={1} />
    </PageShell>
  );
}
