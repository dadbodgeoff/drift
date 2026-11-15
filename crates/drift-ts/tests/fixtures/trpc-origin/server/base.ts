import { initTRPC } from '@trpc/server';

const base = initTRPC.create();
export const pub = base.procedure;
