import { prismaClient } from "../../lib/prisma";
export default function handler(req, res) { res.json(prismaClient.user.findMany()); }
