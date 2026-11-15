import { default as adminProcedure } from '../procedures/authedProcedure';
import { publicProcedure as open, router } from '../trpc';

export const aliasedRouter = router({
  stats: adminProcedure.query(async () => 0),
  feedback: open.mutation(async () => true),
});
