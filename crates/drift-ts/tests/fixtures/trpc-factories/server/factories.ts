import { api, guarded, isAuthed } from './trpc';
import * as trpc from './trpc';

// Functions whose every return is a proven builder: their results are builders.
export function withPermission(permission: string) {
  if (!permission) {
    throw new Error('permission required');
  }
  return guarded.use(async (o: any) => o.next());
}
export const forTeam = (team: string) => api.use(isAuthed).meta({ team });
export const branchy = function (flag: boolean) {
  if (flag) {
    return api;
  }
  return guarded.input({});
};
// A function returning another one's builder, through a namespace.
const nested = () => forTeam('x').use(isAuthed);
export { nested };
export default function () {
  return trpc.api;
}
