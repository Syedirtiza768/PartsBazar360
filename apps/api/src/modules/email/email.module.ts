import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { SendGridService } from './sendgrid.service';

@Global()
@Module({
  providers: [EmailService, SendGridService],
  exports: [EmailService, SendGridService],
})
export class EmailModule {}
