export const db = { link: { findMany: async () => [] as unknown[] } };

// Calls with nested calls are not wrappers: this is a value, not a HOF.
export const linkSchema = z.array(z.string());
declare const z: { array: (x: unknown) => unknown; string: () => unknown };
