declare const t: any;
export const router = t.router;
export const publicProcedure = t.procedure;
export const isAuthed = async (o: any) => o.next();
export const logged = async (o: any) => o.next();
