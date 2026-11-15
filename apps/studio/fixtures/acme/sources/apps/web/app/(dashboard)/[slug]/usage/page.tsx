import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function UsagePage() {
  return (
    <PageShell title="Usage">
      <Stat value={1} />
    </PageShell>
  );
}
