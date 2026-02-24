import { Injectable } from '@nestjs/common';
import { EventDto } from './dtos/event.dto';

@Injectable()
export class WebhookService {
  async processEvent(event: EventDto) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return {
      route: 'primary-carrier',
      decision: 'accepted',
      shipmentId: event.shipmentId,
      eventType: event.status,
    };
  }
}
