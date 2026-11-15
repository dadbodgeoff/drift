import { Controller, Get, Param, Post, Body, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { EnvironmentsService } from "./environments.service";

@Controller("environments")
@UseGuards(AuthGuard)
export class EnvironmentsController {
  constructor(private readonly service: EnvironmentsService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.create(body);
  }
}
