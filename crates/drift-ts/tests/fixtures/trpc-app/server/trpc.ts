declare const t: any;
export const router = t.router;
export const publicProcedure = t.procedure;
export const authenticatedProcedure = t.procedure.use(async (o: any) => o.next());
export const isAdmin = async (o: any) => o.next();
