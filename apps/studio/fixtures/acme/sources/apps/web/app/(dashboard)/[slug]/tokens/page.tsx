import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function TokensPage() {
  return (
    <PageShell title="Tokens">
      <Stat value={1} />
    </PageShell>
  );
}
