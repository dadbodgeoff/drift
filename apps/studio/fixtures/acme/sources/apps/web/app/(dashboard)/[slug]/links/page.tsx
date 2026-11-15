import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function LinksPage() {
  return (
    <PageShell title="Links">
      <Stat value={1} />
    </PageShell>
  );
}
