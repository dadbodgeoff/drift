import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { RefundsService } from "./refunds.service";

@Controller("refunds")
@UseGuards(AuthGuard)
export class RefundsController {
  constructor(private readonly service: RefundsService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }
}
