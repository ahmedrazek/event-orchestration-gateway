import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { EventDto } from './dtos/event.dto';
import { EventQueue } from './event.queue';

@Injectable()
export class WebhookService {
  constructor(private readonly eventQueue: EventQueue) {}
  async processEvent(event: EventDto) {
    return this.eventQueue.addEventToQueue(event);
  }

  async routingEvent(event: EventDto) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const r = Math.random();
    if (r < 0.25) {
      throw new ServiceUnavailableException(
        'Routing service transient failure',
      );
    }

    return {
      route: 'primary-carrier',
      decision: 'accepted',
      shipmentId: event.shipmentId,
      status: event.status,
    };
  }
}
