import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function TagsPage() {
  return (
    <PageShell title="Tags">
      <Stat value={1} />
    </PageShell>
  );
}
