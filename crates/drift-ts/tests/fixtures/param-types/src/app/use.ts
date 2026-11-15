import {
  createState,
  inline,
  overloaded,
  rest,
  untyped,
  withAlias,
  withBound,
  withDto,
  withEnum,
  withExternal,
  withExternalProp,
  withGeneric,
  withInterface,
  withIntersection,
  withLoose,
  withMapped,
  withNamespace,
  withOmit,
  withPartial,
  withPick,
  withPrivate,
  withRequired,
  withUnion,
  wrapped,
} from "../lib";
import { fromJs } from "../lib/legacy.js";
import { fromDts } from "../lib/ambient";
import { Service } from "../lib/service";

export function callsTyped() {
  inline({ a: "", b: 1, c: undefined, d: undefined });
  withInterface({
    id: "",
    label: "",
    name: "",
    note: undefined,
    meta: { trace: "" },
    where: { tenantId: "", deleted: false },
  });
  withNamespace({ id: "", label: "" });
  withAlias({ kind: "a", size: 1, extra: "" });
  withPartial({ id: "", name: "" });
  withRequired({ id: "", label: "" });
  withPick({ id: "", name: "", note: "" });
  withOmit({ id: "", note: "", where: { tenantId: "" } });
  withIntersection({ kind: "a", size: 1, color: "" });
  withGeneric({ value: 1, tag: "", maybe: 1 });
  withBound({ value: "", tag: "", maybe: "" });
  createState({ key: "k", defaultValue: 0, persist: true });
  withDto({ title: "", body: "", draft: true });
  withEnum({ region: "eu" as never, at: new Date(), when: new Date() });
  fromDts({ x: "", y: 1 });
  return Service.build({ region: "eu", zone: "a" });
}

export function callsUnknown() {
  withUnion({ a: "" });
  untyped({ a: "" });
  rest({ a: "" });
  overloaded({ a: "" });
  withMapped({ x: 1, y: 2 });
  withPrivate({ visible: "" } as never);
  withExternal({ anything: "" } as never);
  withExternalProp({ ext: {} as never, plain: "" });
  withLoose({ known: "", other: 1 });
  wrapped({ a: "" });
  fromJs({ a: "" });
}

export class Controller {
  constructor(private readonly service: Service) {}

  handle() {
    return this.service.create({ workspaceId: "w", dryRun: true });
  }
}
