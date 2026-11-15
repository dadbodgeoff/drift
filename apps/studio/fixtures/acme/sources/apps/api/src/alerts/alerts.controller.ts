import { Controller, Get, Param, Post, Body, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { AlertsService } from "./alerts.service";

@Controller("alerts")
@UseGuards(AuthGuard)
export class AlertsController {
  constructor(private readonly service: AlertsService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.create(body);
  }
}
