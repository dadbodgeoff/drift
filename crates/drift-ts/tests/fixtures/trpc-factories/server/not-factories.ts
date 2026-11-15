import { api, guarded, t } from './trpc';

const fake = { procedure: 1 as any };
const holder = { t };
declare function makeT(): typeof t;

// Not proven to return a builder on every path.
export async function asyncFactory() {
  return api;
}
export const asyncArrow = async () => api;
export function* genFactory() {
  yield api;
  return api;
}
export function fallsThrough(flag: boolean) {
  if (flag) {
    return api;
  }
}
export function returnsOther(flag: boolean) {
  if (flag) {
    return api;
  }
  return {} as any;
}
export function bareReturn(flag: boolean) {
  if (flag) return;
  return api;
}
export function shadowed(api: any) {
  return api.use(() => 1);
}
export function localBuilder() {
  const p = api.use(async (o: any) => o.next());
  return p;
}
export function reassigned() {
  return api;
}
// @ts-expect-error reassigned below its declaration
reassigned = () => ({});
export function cyclic(): any {
  return cyclic().use(async (o: any) => o.next());
}
export let letFactory = () => api;
export const conditional = (f: boolean) => (f ? api : guarded);
export const onlyNestedReturns = () => {
  const make = () => {
    return api;
  };
  return make;
};
export const notTrpc = () => fake.procedure;
// Every return is a builder chain, but one is not proven.
export function mixedOrigins(f: boolean) {
  if (f) {
    return api;
  }
  return fake.procedure;
}
// Named like a builder, but its result is not proven to be one.
export function makeProcedure(): any {
  return {};
}
export const optional: (() => typeof api) | undefined = () => api;

// Not a plain `procedure` key of a proven instance bound to a plain name.
export const { procedure: fromFake } = fake;
export const { router: notABuilder } = t;
export const { procedure: withDefault = api } = t;
export let { procedure: fromLet } = t;
export const { t: { procedure: deep } } = holder;
export const { ['procedure']: computed } = t;
export const { procedure: fromCall } = makeT();
