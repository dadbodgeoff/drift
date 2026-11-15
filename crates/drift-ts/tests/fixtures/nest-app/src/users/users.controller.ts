import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, Authenticated, Endpoint, HistoryBuilder } from '../auth/auth.guard';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':id')
  @Authenticated({ permission: 'user.read' })
  get(@Param('id') id: string) {
    return this.users.find(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.users.create(body);
  }

  @Delete(':id')
  @Authenticated({ permission: 'user.delete' })
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }

  @Endpoint({ history: new HistoryBuilder().added('v1') })
  helper() {
    return 1;
  }
}
