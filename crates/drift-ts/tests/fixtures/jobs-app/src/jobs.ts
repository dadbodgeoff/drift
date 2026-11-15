import { schedules, task } from '@trigger.dev/sdk/v3';
import { Worker } from 'bullmq';
import { inngest } from './client';

export const sendWelcome = inngest.createFunction({ id: 'send-welcome' }, { event: 'user/created' }, async ({ event }: any) => event);
export const nightly = inngest.createFunction({ id: 'nightly-report' }, { cron: '0 2 * * *' }, async () => 1);
export const resize = task({ id: 'resize-image', run: async (payload: any) => payload });
export const digest = schedules.task({ id: 'weekly-digest', run: async () => 1 });
export const worker = new Worker('emails', async (job: any) => job.data);
