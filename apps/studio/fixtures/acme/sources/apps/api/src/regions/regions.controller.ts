import { Controller, Get, Param, Post, Body, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { RegionsService } from "./regions.service";

@Controller("regions")
@UseGuards(AuthGuard)
export class RegionsController {
  constructor(private readonly service: RegionsService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.create(body);
  }
}
