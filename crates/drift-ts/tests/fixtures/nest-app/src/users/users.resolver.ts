import { UseGuards } from '@nestjs/common';
import { Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthGuard } from '../auth/auth.guard';
import { UsersService } from './users.service';

@Resolver()
@UseGuards(AuthGuard)
export class UsersResolver {
  constructor(private readonly users: UsersService) {}

  @Query(() => String)
  me() {
    return this.users.find('me');
  }

  @Mutation(() => Boolean)
  deleteMe() {
    return this.users.remove('me');
  }
}
