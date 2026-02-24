import { Job } from 'bullmq';
import { EVENT_QUEUE } from './event-queue.constant';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { EventDto } from './dtos/event.dto';
import { WebhookService } from './webhook.service';
import { EventLog, EventLogDocument } from './schema/event-log.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
@Processor(EVENT_QUEUE, {
  concurrency: 5,
  stalledInterval: 120000,
  maxStalledCount: 30,
})
export class EventProcessor extends WorkerHost {
  constructor(
    private readonly webhookService: WebhookService,
    @InjectModel(EventLog.name)
    private readonly eventLogModel: Model<EventLogDocument>,
  ) {
    super();
  }

  async process(job: Job<EventDto>) {
    await this.webhookService.routingEvent(job.data);
    return this.webhookService.processEvent(job.data);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<EventDto>, error: Error) {
    await this.eventLogModel
      .updateOne(
        { eventId: job.data.eventId },
        {
          $set: { status: 'failed', lastError: error.message },
        },
      )
      .exec();
  }
}
