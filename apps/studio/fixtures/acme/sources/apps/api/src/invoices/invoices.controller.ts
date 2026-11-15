import { Controller, Get, Param, Post, Body, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { InvoicesService } from "./invoices.service";

@Controller("invoices")
@UseGuards(AuthGuard)
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.create(body);
  }
}
