"use client";

import { listUsers } from "@/lib/users";
import { saveLink } from "@/actions/save";

export function Leaky() {
  const key = process.env.STRIPE_SECRET_KEY;
  const pub = process.env.NEXT_PUBLIC_APP_URL;
  return <button onClick={() => saveLink(String(listUsers()))}>{key}{pub}</button>;
}
