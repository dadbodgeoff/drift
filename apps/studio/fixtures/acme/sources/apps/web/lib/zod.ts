import { z } from "zod";

export const idSchema = z.object({ workspaceId: z.string(), id: z.string().optional(), name: z.string().optional() });
