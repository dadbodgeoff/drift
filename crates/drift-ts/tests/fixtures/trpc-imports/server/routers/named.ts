import { publicProcedure, router } from '../trpc';

export const health = publicProcedure.query(() => 'ok');
export const signup = publicProcedure.mutation(async () => true);

export const namedRouter = router({
  ticks: publicProcedure.subscription(async () => null),
});
