"use server";

import { requireUser } from "@/lib/auth";

export async function saveLink(url: string) {
  const user = await requireUser();
  return { user, url };
}
