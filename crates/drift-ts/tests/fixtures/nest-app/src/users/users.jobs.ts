import { Cron } from '@nestjs/schedule';
import { Process, Processor } from '@nestjs/bullmq';
import { MessagePattern } from '@nestjs/microservices';

@Processor('emails')
export class EmailProcessor {
  @Process('send')
  async send() {
    return true;
  }
}

export class Maintenance {
  @Cron('0 * * * *')
  cleanup() {
    return 0;
  }

  @MessagePattern('user.created')
  onUserCreated() {
    return 1;
  }
}
