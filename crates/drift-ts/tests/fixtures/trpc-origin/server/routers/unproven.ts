import { ghost } from '../missing';
import { c1, notCreated, oddlyConfigured, objectMember, otherPackage, reassignable, stepped, transformed } from '../not-builders';
import { router } from '../trpc';

// Builders whose origin is not proven: ordinary calls, not procedures.
export const a = objectMember.query(() => 1);
export const b = ghost.mutation(async () => true);
export const unprovenRouter = router({
  c: otherPackage.query(() => 1),
  d: notCreated.query(() => 1),
  e: transformed.query(() => 1),
  f: stepped.query(() => 1),
  g: reassignable.query(() => 1),
  h: c1.query(() => 1),
  i: oddlyConfigured.query(() => 1),
});
