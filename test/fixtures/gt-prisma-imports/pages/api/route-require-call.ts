// D5.2 RETAIN — a `require()` binding that reaches the datastore.
declare const require: (id: string) => any;

export default async function handler(req: any, res: any) {
  const store = require("../../lib/prisma");
  return res.json(await store.prismaClient.user.findMany());
}
