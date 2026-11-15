export class UsersService {
  find(id: string) { return id; }
  create(b: unknown) { return b; }
  remove(id: string) { return id; }
}
export namespace Users {
  export const kind = 'user';
}
export async function lazy() {
  const m = await import('./lazy-module');
  return m;
}
