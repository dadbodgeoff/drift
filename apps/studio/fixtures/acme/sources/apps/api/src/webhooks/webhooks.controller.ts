import { Controller, Get, Param, Post, Body, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { WebhooksService } from "./webhooks.service";

@Controller("webhooks")
@UseGuards(AuthGuard)
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.create(body);
  }
}
