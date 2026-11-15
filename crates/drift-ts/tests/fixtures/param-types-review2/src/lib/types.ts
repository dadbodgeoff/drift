// `any` and `unknown` in unions and intersections.
export type IU = { a: string | undefined; z: number } & { a: unknown };
export type IU2 = { a?: string; z: number } & { a: unknown };
export type IU4 = Partial<{ a: string }> & { a: unknown; z: number };
export interface Gen<T> { a: T; z: number }
export type IU5 = Gen<string | undefined> & Gen<unknown>;
export type Top = unknown;
export type IU6 = { a: string | undefined; z: number } & { a: Top };
export type UU = { a: undefined | unknown; z: number };
export type UA = { a: undefined | any; z: number };
export type Plain = { a: unknown; b: any; z: number };
export type WithTop = { a: string; z: number } & unknown;

// An interface an augmentation gives an index signature.
export interface AugO { a: string; b: number }
export interface NotAug { a: string; b: number }
