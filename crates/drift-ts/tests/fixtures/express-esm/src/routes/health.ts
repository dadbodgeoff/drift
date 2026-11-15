import { Router } from "express";

// An anonymous default-exported router with its registrations chained on it.
export default Router()
  .get("/", (req, res) => res.send("ok"))
  .get("/ready", (req, res) => res.send("ready"));
