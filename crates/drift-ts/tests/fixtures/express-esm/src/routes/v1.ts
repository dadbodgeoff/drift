import express from "express";
import { auth } from "../middlewares/auth";
import { users } from "./users";

// Declared and exported in one statement.
export const v1 = express.Router();

v1.use(auth);
v1.use("/users", users);
v1.get("/ping", (req, res) => res.send("pong"));
