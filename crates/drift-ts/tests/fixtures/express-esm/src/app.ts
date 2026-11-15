import express from "express";
import { v1 } from "./routes/v1";
import health from "./routes/health";
import status from "./routes/status";

const app = express();
app.use("/api", v1);
app.use("/health", health);
app.use("/status", status);

export default app;
