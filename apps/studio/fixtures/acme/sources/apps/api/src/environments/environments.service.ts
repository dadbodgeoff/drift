import { Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";

@Injectable()
export class EnvironmentsService extends BaseService {
  async get(id: string) {
    this.log("get " + id);
    return this.db.link.findFirst({ where: { id } });
  }

  async create(body: Record<string, unknown>) {
    return { id: "new", ...body };
  }
}
