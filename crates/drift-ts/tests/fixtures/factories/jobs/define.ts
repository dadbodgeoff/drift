export function defineJob<T>(run: (payload: T) => Promise<void>) {
  return run;
}

export function withTrace<T>(run: T): T {
  return run;
}
