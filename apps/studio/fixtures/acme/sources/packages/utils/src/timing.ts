type Next = () => void;

export function timing(req: { path: string }, res: unknown, next: Next) {
  const started = Date.now();
  next();
  recordTiming(req.path, Date.now() - started);
}

export function recordTiming(route: string, ms: number) {
  return `${route} ${ms}ms`;
}
