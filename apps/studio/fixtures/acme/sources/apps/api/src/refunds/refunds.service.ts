import { Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";

@Injectable()
export class RefundsService extends BaseService {
  async get(id: string) {
    this.log("get " + id);
    return this.db.link.findFirst({ where: { id } });
  }
}
