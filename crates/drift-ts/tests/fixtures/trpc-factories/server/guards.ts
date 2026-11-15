import { api, isAuthed } from './trpc';

export const editor = api.use(isAuthed);
