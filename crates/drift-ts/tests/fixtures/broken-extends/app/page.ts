import { db } from "lib/db";
import { auth } from "~/auth";
import { z } from "zod";

export function page() {
  auth();
  return [db, z];
}
