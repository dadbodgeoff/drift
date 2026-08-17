// D-H2 and D-H3 in one file, and dub's real shape: a route handler outside any folder called `api`,
// with no auth wrapper, importing the data layer directly and calling it. Before W7 neither half was
// visible - the file was not a file with a role, and its data layer was not a data layer.
import { NextResponse } from "next/server";
import { store } from "@stacks/drizzle";

export async function GET(_request: Request, props: { params: { domain: string } }) {
  const rows = await store.select().from("domains");
  return NextResponse.json({ domain: props.params.domain, rows });
}
