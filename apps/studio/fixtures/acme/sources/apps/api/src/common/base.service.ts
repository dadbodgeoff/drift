import { db } from "@acme/db";

export abstract class BaseService {
  protected readonly db = db;

  protected log(message: string) {
    console.log(`[${this.constructor.name}] ${message}`);
  }
}
