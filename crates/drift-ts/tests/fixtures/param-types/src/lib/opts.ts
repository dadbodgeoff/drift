// Declarations the callees in this fixture take. Each shape the resolver reads,
// and each it leaves unknown.

export interface BaseOpts {
  id: string;
  label?: string;
}

export interface Opts extends BaseOpts {
  name: string;
  note: string | undefined;
  meta?: { trace: string };
  where: { tenantId: string; deleted?: boolean };
}

export type Alias = { kind: "a" | "b"; size: number; extra?: string };

export type WithUndefined = string | undefined;

export type Mixed = Alias & { color: string; size?: number };

export interface Box<T> {
  value: T;
  tag: string;
  maybe: T | undefined;
}

export type Keys = "id" | "name";

export class CreateDto {
  title!: string;
  body?: string;
  draft: boolean = false;
}

export class Secretive {
  private secret = "";
  visible!: string;
}

export type Mapped = { [K in "x" | "y"]: number };

export type Loose = { [key: string]: unknown; known: string };

export enum Region {
  Eu = "eu",
  Us = "us",
}
