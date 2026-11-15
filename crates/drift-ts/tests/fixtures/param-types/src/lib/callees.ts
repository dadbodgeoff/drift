import type { Alias, Box, CreateDto, Keys, Loose, Mapped, Mixed, Opts, Secretive, WithUndefined } from "./opts";
import type * as O from "./opts";
import type { Region } from "./opts";
import type { External } from "not-installed-pkg";

export function inline(o: { a: string; b?: number; c: string | undefined; d: WithUndefined }) {
  return o;
}

export const withInterface = (o: Opts) => o;
export const withNamespace = (o: O.BaseOpts) => o;
export function withAlias(o: Alias) {
  return o;
}
export const withPartial = (o: Partial<Opts>) => o;
export const withRequired = (o: Required<O.BaseOpts>) => o;
export const withPick = (o: Pick<Opts, Keys | "note">) => o;
export const withOmit = (o: Omit<Opts, "name">) => o;
export const withIntersection = (o: Mixed) => o;
export const withGeneric = <T>(o: Box<T>) => o;
export const withBound = (o: Box<string>) => o;

export const createState = <V>({
  key,
  defaultValue,
  persist = false,
}: {
  key: string;
  defaultValue: V;
  persist: boolean;
}) => ({ key, defaultValue, persist });

export const withEnum = (o: { region: Region; at: Date; when?: Date }) => o;

export function withDto(dto: CreateDto) {
  return dto;
}

// Unknown: a union, no annotation, a rest parameter, overloads, a mapped type,
// a private class, an uninstalled package's type, an index signature's extra key.
export function withUnion(o: { a: string } | { b: string }) {
  return o;
}
export function untyped(o) {
  return o;
}
export function rest(...xs: Array<{ a: string }>) {
  return xs;
}
export function overloaded(o: { a: string }): void;
export function overloaded(o: { b: string }): void;
export function overloaded(o: unknown) {
  return o;
}
export const withMapped = (o: Mapped) => o;
export const withPrivate = (o: Secretive) => o;
export const withExternal = (o: External) => o;
export const withExternalProp = (o: { ext: External; plain: string }) => o;
export const withLoose = (o: Loose) => o;
export const wrapped = memo((o: { a: string }) => o);

declare function memo<F>(f: F): F;
