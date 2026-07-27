import { listUsers } from "../../../services/users";

export async function GET() {
  return Response.json(await listUsers());
}
