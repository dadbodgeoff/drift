export const withRequiredScope = (scope: string) => async (_c: unknown, next: () => Promise<void>) => next();
export const withAuth = async (_c: unknown, next: () => Promise<void>) => next();
