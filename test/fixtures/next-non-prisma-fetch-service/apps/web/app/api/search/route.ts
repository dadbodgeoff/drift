import { searchUsers } from "@/services/search";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json(await searchUsers(query));
}
