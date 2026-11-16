// A convention Drift proposed from its map of the code (`from_map`: the layers of the structure map, the package
// manifests, the practice map), not mined: said where the card shows its source, with the one sentence that tells
// a reviewer it did not pass through the miner's measured gates. Props only, so a unit test renders it.
import { Badge } from "@drift/ui";
import type { FromMap } from "@/shared/contract/drift";
import { t } from "@/shared/i18n";

/** Which of Drift's maps, in words. */
export function fromMapSource(m: FromMap): string {
  return m === "layering" ? t("conventions.fromMap.layering") : m === "manifest" ? t("conventions.fromMap.manifest") : t("conventions.fromMap.practice");
}

/** The sentence a proposal from the map carries. */
export function fromMapText(m: FromMap): string {
  return t("conventions.fromMap.note", { source: fromMapSource(m) });
}

export function FromMapBadge({ fromMap }: { fromMap: FromMap }) {
  return (
    <Badge variant="outline" icon="map" className="cv-frommap" title={fromMapText(fromMap)}>
      {t("conventions.fromMap.badge")} · {fromMap}
    </Badge>
  );
}

export function FromMapNote({ fromMap }: { fromMap: FromMap }) {
  return (
    <p className="st-note cv-frommap-note" role="note">
      {fromMapText(fromMap)}
    </p>
  );
}
