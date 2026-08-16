// The repo's own data-access module. `@/lib/prisma` in papermark; a relative path here so the
// fixture needs no path-alias config.
export const prismaClient = {
  user: { findMany: async () => [] },
  link: { findMany: async () => [] }
};
export const auditLog = { write: async (_e: unknown) => undefined };
