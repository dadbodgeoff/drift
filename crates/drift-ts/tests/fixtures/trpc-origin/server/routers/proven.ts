import { z } from 'zod';
import auth, { api, authed, described, router } from '../trpc';
import { guarded as g, pub, viaDefault } from '../builders';
import * as builders from '../builders';
import { admin } from '../alias';

export const me = authed.query(async ({ ctx }: any) => ctx.user);
export const ping = api.query(() => 'pong');
export const rename = api.input(z.string()).mutation(async ({ input }: any) => input);

export const provenRouter = router({
  open: pub.query(() => 1),
  save: g.mutation(async () => true),
  events: admin.subscription(async () => null),
  stats: builders.guarded.query(async () => 0),
  docs: described.query(() => 'x'),
  logs: auth.query(async () => []),
  fresh: viaDefault.mutation(async () => true),
});
