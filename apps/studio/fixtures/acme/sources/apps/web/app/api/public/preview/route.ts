import { NextResponse } from "next/server";

// Fetches a page title for link previews.
export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get("url") ?? "";
  const html = await (await fetch(target)).text();
  return NextResponse.json({ title: html.match(/<title>(.*?)<\/title>/)?.[1] ?? null });
}
