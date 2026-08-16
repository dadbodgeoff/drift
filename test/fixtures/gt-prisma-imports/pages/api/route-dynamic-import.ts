// D5.2 RETAIN — a DYNAMIC `import()` binding that reaches the datastore.
//
// `require()` and dynamic `import()` execute the module by construction (facts.rs marks them
// `runtime_use: "dynamic"`), so there is no type-only reading of this shape to suppress on.
export default async function handler(req: any, res: any) {
  const store = await import("../../lib/prisma");
  return res.json(await store.prismaClient.user.findMany());
}
