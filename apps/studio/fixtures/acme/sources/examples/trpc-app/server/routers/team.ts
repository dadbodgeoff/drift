import { authenticatedProcedure, isAdmin, publicProcedure, router } from '../trpc';
import { getTeamRoute } from './get-team';

export const teamRouter = router({
  get: getTeamRoute,
  delete: authenticatedProcedure.use(isAdmin).mutation(async () => true),
  health: publicProcedure.query(() => 'ok'),
});
