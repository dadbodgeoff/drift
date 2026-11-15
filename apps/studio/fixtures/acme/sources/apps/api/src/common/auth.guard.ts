import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    return Boolean(ctx.switchToHttp().getRequest().headers.authorization);
  }
}
