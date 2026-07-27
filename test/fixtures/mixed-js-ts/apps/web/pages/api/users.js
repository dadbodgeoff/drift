import { listUsers } from "../../services/users";

export default async function handler() {
  return Response.json(await listUsers());
}
