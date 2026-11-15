import { z } from 'zod';
import authedProcedure from '../procedures/authedProcedure';
import { logged } from '../trpc';

export const me = authedProcedure.query(async ({ ctx }: any) => ctx.user);
export const save = authedProcedure.mutation(async ({ ctx }: any) => ctx.db.user.update({}));
export const onEvent = authedProcedure.subscription(async () => null);
export const rename = authedProcedure
  .input(z.object({ name: z.string() }))
  .mutation(async ({ input }: any) => input.name);
export const audit = authedProcedure.use(logged).query(async () => []);
