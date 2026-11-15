import { Controller, Get, Param, Post, Body, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { MilestonesService } from "./milestones.service";

@Controller("milestones")
@UseGuards(AuthGuard)
export class MilestonesController {
  constructor(private readonly service: MilestonesService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.create(body);
  }
}
