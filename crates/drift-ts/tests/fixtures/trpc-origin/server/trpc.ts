import { initTRPC } from '@trpc/server';

type Ctx = { user?: { id: string } };
const t = initTRPC.context<Ctx>().meta<{ auth: boolean }>().create({});

export const isAuthed = t.middleware(async (o: any) => o.next());
export const logged = async (o: any) => o.next();
export const router = t.router;
// Builders whose names say nothing: their origin (`t.procedure`) proves them.
export const api = t.procedure;
export const authed = t.procedure.use(isAuthed);
export const described = t.procedure.meta({ auth: false });
export default authed.use(logged);
