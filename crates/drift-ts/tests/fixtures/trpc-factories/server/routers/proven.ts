import { z } from 'zod';
import makeDefault, { branchy, forTeam, nested, withPermission } from '../factories';
import * as factories from '../factories';
import { api, router } from '../trpc';
import { viaImport } from '../remote';
import { canEdit } from '../perms';

export const me = withPermission('me.read').query(async ({ ctx }: any) => ctx.user);
export const ping = api.query(() => 'pong');
const teamApi = forTeam('a');

export const provenRouter = router({
  team: teamApi.query(() => 1),
  branch: branchy(true).input(z.string()).mutation(async () => true),
  events: nested().subscription(async () => null),
  fallback: makeDefault().query(() => 0),
  spaced: factories.forTeam('b').query(() => 2),
  remote: viaImport.query(() => 3),
  edit: canEdit().mutation(async () => true),
});
