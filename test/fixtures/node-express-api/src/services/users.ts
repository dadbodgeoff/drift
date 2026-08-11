import { queryUsers } from "../db";

export async function listUsers() {
  return queryUsers();
}
