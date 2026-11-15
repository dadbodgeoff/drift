import fastify from 'fastify';
import { registerSecretRouter } from './routes/secrets';

const server = fastify();
server.register(registerSecretRouter, { prefix: '/api/v1/secrets' });

export default server;
