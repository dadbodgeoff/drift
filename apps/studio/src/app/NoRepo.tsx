import { Button, EmptyState } from "@drift/ui";
import { t } from "@/shared/i18n";

export function NoRepo({ onOpen }: { onOpen(): void }) {
  return (
    <div className="st-center">
      <EmptyState icon="repo" title={t("shell.noRepo")} action={<Button variant="primary" icon="folder" onClick={onOpen}>{t("shell.openRepo")}</Button>}>
        {t("shell.noRepoBody")}
      </EmptyState>
    </div>
  );
}
