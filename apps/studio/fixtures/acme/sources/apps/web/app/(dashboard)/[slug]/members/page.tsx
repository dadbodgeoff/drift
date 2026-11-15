import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function MembersPage() {
  return (
    <PageShell title="Members">
      <Stat value={1} />
    </PageShell>
  );
}
