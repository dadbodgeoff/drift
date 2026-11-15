import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function FoldersPage() {
  return (
    <PageShell title="Folders">
      <Stat value={1} />
    </PageShell>
  );
}
