import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function ExportsPage() {
  return (
    <PageShell title="Exports">
      <Stat value={1} />
    </PageShell>
  );
}
