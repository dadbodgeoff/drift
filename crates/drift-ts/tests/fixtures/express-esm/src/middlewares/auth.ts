import type { NextFunction, Request, Response } from "express";

export function auth(req: Request, res: Response, next: NextFunction) {
  next();
}

export const admin = (req: Request, res: Response, next: NextFunction) => next();
