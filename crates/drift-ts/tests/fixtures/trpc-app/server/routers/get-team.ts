import { z } from 'zod';
import { authenticatedProcedure } from '../trpc';

export const getTeamRoute = authenticatedProcedure
  .input(z.object({ teamId: z.number() }))
  .query(async ({ input, ctx }: any) => ctx.db.team.findFirst({ where: { id: input.teamId, userId: ctx.user.id } }));
