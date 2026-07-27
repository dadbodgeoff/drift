import { db } from "../lib/db";

export async function listUsers() {
  return db.user.findMany();
}
