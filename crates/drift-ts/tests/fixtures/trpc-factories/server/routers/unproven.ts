import { z } from 'zod';
import * as nf from '../not-factories';
import {
  asyncArrow, asyncFactory, bareReturn, computed, conditional, cyclic, deep, fallsThrough, fromCall, fromFake,
  fromLet, genFactory, notABuilder, letFactory, localBuilder, makeProcedure, mixedOrigins, notTrpc, onlyNestedReturns,
  optional, reassigned, returnsOther, shadowed, withDefault,
} from '../not-factories';
import { router } from '../trpc';

// Builders whose origin is not proven: ordinary calls, not procedures.
export const a = asyncFactory().query(() => 1);
export const b = makeProcedure().input(z.string()).mutation(async () => true);
export const unprovenRouter = router({
  c: genFactory().query(() => 1),
  d: fallsThrough(true).query(() => 1),
  e: returnsOther(true).query(() => 1),
  f: bareReturn(true).query(() => 1),
  g: shadowed(1).query(() => 1),
  h: localBuilder().query(() => 1),
  i: reassigned().query(() => 1),
  j: cyclic().query(() => 1),
  k: letFactory().query(() => 1),
  l: conditional(true).query(() => 1),
  m: onlyNestedReturns()().query(() => 1),
  n: notTrpc().query(() => 1),
  o: optional?.().query(() => 1),
  p: nf.makeProcedure().use(async (x: any) => x.next()).query(() => 1),
  q: fromFake.query(() => 1),
  r: withDefault.query(() => 1),
  s: fromLet.query(() => 1),
  u: deep.query(() => 1),
  v: computed.query(() => 1),
  w: fromCall.query(() => 1),
  x: asyncArrow().query(() => 1),
  y: notABuilder.query(() => 1),
  z: mixedOrigins(true).query(() => 1),
});
