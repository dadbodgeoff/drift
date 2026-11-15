import { Injectable } from "@nestjs/common";
import { db } from "@acme/db";

@Injectable()
export class AuditsService {
  async get(id: string) {
    return db.link.findFirst({ where: { id } });
  }

  async create(body: Record<string, unknown>) {
    return { id: "new", ...body };
  }
}
