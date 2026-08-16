// The negative control for D-H2, and the non-Next stack: an Express router in a file called
// route.ts, under a folder called api, with no `app` ancestor. It is not a Next route handler and
// must not become one - the widening has a boundary and this is it.
import { Router } from "express";
import { store } from "@stacks/drizzle";

export const usersRouter = Router();

usersRouter.get("/", async (_request, response) => {
  response.json(await store.select().from("users"));
});
