import { authedProcedure, openProcedure } from '../procedures';
import * as procedures from '../procedures';
import { router } from '../trpc';

export const deleteMe = authedProcedure.mutation(async () => true);
export const reexportRouter = router({
  version: openProcedure.query(() => '1'),
  wipe: procedures.authedProcedure.mutation(async () => true),
});
