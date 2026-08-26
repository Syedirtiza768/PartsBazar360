import { Controller, Get } from '@nestjs/common';
import { ContentService } from './content.service';

@Controller('policy')
export class PolicyController {
  constructor(private readonly content: ContentService) {}

  @Get('shipping')
  getShippingPolicy() {
    return this.content.getShippingPolicy();
  }
}
