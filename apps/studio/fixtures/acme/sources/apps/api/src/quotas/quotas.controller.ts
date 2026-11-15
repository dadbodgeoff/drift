import { Controller, Get, Param, Post, Body, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { QuotasService } from "./quotas.service";

@Controller("quotas")
@UseGuards(AuthGuard)
export class QuotasController {
  constructor(private readonly service: QuotasService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.create(body);
  }
}
