import { Router } from "express";
import { listUsers } from "../services/users";

export const usersRouter = Router();

usersRouter.get("/users", async (_req, res) => {
  res.json(await listUsers());
});
