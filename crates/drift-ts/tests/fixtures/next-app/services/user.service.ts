import { Injectable } from "@nestjs/common";
import { BaseService } from "./base";

@Injectable()
export class UserService extends BaseService {
  find() {
    return this.repo();
  }
}
