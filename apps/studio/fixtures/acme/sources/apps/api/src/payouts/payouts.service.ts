import { Injectable } from "@nestjs/common";
import { BaseService } from "../common/base.service";

@Injectable()
export class PayoutsService extends BaseService {
  async list() {
    return this.db.link.findMany();
  }
}
