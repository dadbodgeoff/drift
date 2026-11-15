import { exec } from "child_process";
import { createHash } from "crypto";
import jwt from "jsonwebtoken";
import cors from "cors";
import { z } from "zod";
import { prisma } from "./db";
import { AppError } from "./errors";

const schema = z.object({ url: z.string() });

export async function listLinks(workspaceId: string, body: unknown): Promise<unknown[]> {
  const input = schema.parse(body);
  if (!process.env.DATABASE_URL) throw new AppError("no db");
  return prisma.link.findMany({ where: { workspaceId, url: input.url } });
}

export function dangerous(req: any, res: any, cmd: string, q: string) {
  exec(cmd);
  eval(q);
  createHash("md5").update(q);
  jwt.decode(req.token);
  prisma.$queryRawUnsafe(q);
  res.redirect(req.query.next);
  res.cookie("sid", "x", { secure: true });
  fetch(req.body.url);
  const x: any = 1;
  document.body.innerHTML = q;
  throw new Error(String(x));
}

export const app = cors();

export const Html = ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />;

export function safe(res: any) {
  res.redirect("/home");
  res.cookie("sid", "x", { httpOnly: true });
  return fetch("https://api.example.com/v1/items");
}

// Regression: a template that is only a scheme (`http://${host}`) once crashed the scanner.
export function hostOnly(host: string, path: string) {
  fetch(`http://${host}`);
  return fetch(`https://api.example.com/${path}`);
}

// Configured origins are not request-controlled.
const API_BASE = "https://api.example.com";
export function configured(id: string) {
  fetch(process.env.WEBHOOK_URL);
  const HOOK = process.env.LOG_HOOK;
  fetch(HOOK);
  fetch(`${API_BASE}/v1`);
  return fetch(`${process.env.API_URL}/items/${id}`);
}
