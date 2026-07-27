import express from "express";
import { usersRouter } from "./routes/users";

const app = express();

app.use("/api", usersRouter);

export { app };
