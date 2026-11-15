import { verifyAuth, verifySuperAdmin } from '../auth';

export const registerSecretRouter = async (server: any) => {
  server.route({
    method: 'GET',
    url: '/:id',
    onRequest: verifyAuth(['jwt']),
    handler: async (req: any) => ({ id: req.params.id }),
  });
  server.route({
    method: ['POST', 'PUT'],
    url: '/',
    preHandler: [verifyAuth(['jwt', 'token'])],
    handler: async () => ({}),
  });
  // Inline hook: the curried guard and the one in its continuation both count.
  server.route({
    method: 'DELETE',
    url: '/:id',
    onRequest: (req: any, res: any, done: any) => {
      verifyAuth(['jwt'])(req, res, () => {
        verifySuperAdmin(req, res, done);
      });
    },
    handler: async () => ({}),
  });
  server.route({
    method: 'GET',
    url: '/public',
    handler: async () => ({}),
  });
};
