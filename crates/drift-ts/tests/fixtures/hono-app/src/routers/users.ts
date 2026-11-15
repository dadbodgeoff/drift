import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { withRequiredScope } from '../middleware';

const app = new OpenAPIHono();

const getUser = createRoute({
  method: 'get',
  path: '/{id}',
  middleware: [withRequiredScope('users.read')],
  responses: {},
});

app.openapi(getUser, (c) => c.json({}));

app.openapi(
  createRoute({ method: 'post', path: '/', middleware: [withRequiredScope('users.write')], responses: {} }),
  (c) => c.json({}),
);

export const usersRouter = app;
