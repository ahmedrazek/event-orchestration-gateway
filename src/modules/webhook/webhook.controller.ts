import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { SignatureGuard } from 'src/guards/signature.guard';
import { EventDto } from './dtos/event.dto';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('event')
  @UseGuards(SignatureGuard)
  @HttpCode(202)
  async handleEvent(@Body() event: EventDto) {
    return this.webhookService.processEvent(event);
  }
}
