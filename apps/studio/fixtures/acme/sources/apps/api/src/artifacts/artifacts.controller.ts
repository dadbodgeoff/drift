import { Controller, Get, Param, Post, Body, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { ArtifactsService } from "./artifacts.service";

@Controller("artifacts")
@UseGuards(AuthGuard)
export class ArtifactsController {
  constructor(private readonly service: ArtifactsService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.service.get(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.service.create(body);
  }
}
