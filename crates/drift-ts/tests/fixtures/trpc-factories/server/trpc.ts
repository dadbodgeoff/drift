import { initTRPC } from '@trpc/server';

export const t = initTRPC.create();

export const isAuthed = t.middleware(async (o: any) => o.next());
export const router = t.router;
// Builders destructured from the instance: `t.procedure` under another name.
export const { procedure: api } = t;
const { procedure: inner, router: _unused } = t;
export const guarded = inner.use(isAuthed);
