import { pgTable, text } from "drizzle-orm/pg-core";

export const domains = pgTable("domains", { id: text("id"), workspaceId: text("workspace_id") });
