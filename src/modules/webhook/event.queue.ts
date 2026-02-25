import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EVENT_QUEUE } from './event-queue.constant';
import { EventDto } from './dtos/event.dto';
@Injectable()
export class EventQueue {
  constructor(@InjectQueue(EVENT_QUEUE) private readonly queue: Queue) {}

  async addEventToQueue(event: EventDto) {
    const jobId = `event-${event.eventId}`;
    try {
      const job = await this.queue.add(event.eventId, event, { jobId });
      return {
        jobId: String(job.id ?? jobId),
        status: 'Queued',
        message: 'Event is being processed',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (
        message.includes('Job') &&
        message.includes('already') &&
        message.includes('exist')
      ) {
        return {
          jobId,
          status: 'Queued',
          message: 'Duplicate event accepted and already queued',
        };
      }
      throw error;
    }
  }
}
