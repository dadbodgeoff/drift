import { Hono } from 'hono';
import { withAuth } from './middleware';
import { publicRouter } from './routers/public';
import { usersRouter } from './routers/users';

const app = new Hono();
// Public routes are mounted before the auth middleware, so they do not inherit it.
app.route('/public', publicRouter);
app.use(withAuth);
app.get('/health', (c) => c.text('ok'));
app.route('/users', usersRouter);

export default app;
