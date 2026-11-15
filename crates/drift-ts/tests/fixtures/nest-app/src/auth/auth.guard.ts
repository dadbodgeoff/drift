export class AuthGuard {}
export const Authenticated = (opts?: { permission?: string }) => () => undefined;
export class HistoryBuilder {
  added(version: string) {
    return this;
  }
}
export const Endpoint = (opts: { history: HistoryBuilder }) => () => undefined;
