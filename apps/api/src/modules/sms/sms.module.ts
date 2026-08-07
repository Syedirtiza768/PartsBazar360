import { Global, Module } from '@nestjs/common';
import { SmsGlobalService } from './smsglobal.service';

@Global()
@Module({
  providers: [SmsGlobalService],
  exports: [SmsGlobalService],
})
export class SmsModule {}
