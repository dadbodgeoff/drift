import { Controller, Get, Param, Post, Body, UseGuards } from "@nestjs/common";
import { ReleasesService } from "./releases.service";

@Controller("releases")
export class ReleasesController {
  constructor(private readonly service: ReleasesService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.create(body);
  }
}
