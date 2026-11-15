import { Controller, Get, Param, Post, Body, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { SessionsService } from "./sessions.service";

@Controller("sessions")
@UseGuards(AuthGuard)
export class SessionsController {
  constructor(private readonly service: SessionsService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.create(body);
  }
}
