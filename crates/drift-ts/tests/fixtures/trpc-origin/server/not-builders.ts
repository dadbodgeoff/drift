import { initTRPC } from 'not-trpc';
import { initTRPC as realInit } from '@trpc/server';
import { api } from './trpc';

const fake = { procedure: 1 as any };
const lookalike = initTRPC.create();
const unfinished = realInit.context<{}>();
const real = realInit.create();
const configured = realInit.context<{}>().other().create();

// Not built from a tRPC instance's `.procedure`.
export const objectMember = fake.procedure;
export const otherPackage = lookalike.procedure;
export const notCreated = unfinished.procedure;
export const oddlyConfigured = configured.procedure;
// Built from one, but by a step that is not a builder step.
export const transformed = (api as any).other();
export const stepped = real.procedure.other();
// A `let` may be reassigned.
export let reassignable = real.procedure;
// A cycle proves nothing (and ends).
export const c1: any = c2;
export const c2: any = c1;
