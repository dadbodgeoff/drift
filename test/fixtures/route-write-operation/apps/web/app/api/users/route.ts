import { createUser } from "../../../services/users";

export async function POST() {
  return Response.json(await createUser());
}
