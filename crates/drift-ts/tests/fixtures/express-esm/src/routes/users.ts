import { Router, type Request, type Response } from "express";
import { admin } from "../middlewares/auth";

const list = (req: Request, res: Response) => res.json([]);

// A named `Router` import, exported in place.
export const users: Router = Router({ mergeParams: true });

users.get("/", list);
users.delete("/:id", admin, (req, res) => res.sendStatus(204));
