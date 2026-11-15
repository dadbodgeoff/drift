import { Stat } from "@acme/ui";
import { PageShell } from "@/components/page-shell";

export default async function SettingsPage() {
  return (
    <PageShell title="Settings">
      <Stat value={1} />
    </PageShell>
  );
}
