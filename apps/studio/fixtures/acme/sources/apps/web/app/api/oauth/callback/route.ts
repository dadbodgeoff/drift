import { redirect } from "next/navigation";

export async function GET(req: Request) {
  const next = new URL(req.url).searchParams.get("next") ?? "/";
  redirect(next);
}
