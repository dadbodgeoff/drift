export interface Opts { a: string; b?: string; c: string | undefined }
export type BaseA = { a: string | undefined; z: number };
export interface ExtA extends BaseA { c: string }
export interface GOpts<T = undefined> { a: T; b: string }
export type GA<T = string | undefined> = { a: T; b: string };
export interface G2<A, B = undefined> { a: A; b: B }
export interface Open { [k: string]: unknown; a: string; b: number }
export class Cfg {
  get name(): string | undefined { return undefined; }
  size!: number;
}
export class SetOnly { set v(x: string | undefined) {} w!: number }
export interface IG { get label(): string | undefined; n: number }
namespace NS { export type Inner = string | undefined }
import Inner = NS.Inner;
export interface IE { a: Inner; b: number }
