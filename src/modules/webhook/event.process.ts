import { Job, Queue } from 'bullmq';
import {
  DLQ_AUTO_REPLAY_DELAY_MS,
  DLQ_MAX_AUTO_REPLAYS,
  DLQ_QUEUE,
  EVENT_QUEUE,
} from './event-queue.constant';
import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { EventDto, EventStatus } from './dtos/event.dto';
import { WebhookService } from './webhook.service';
import { EventLog, EventLogDocument } from './schema/event-log.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Shipment, ShipmentDocument } from './schema/shipment.schema';

export interface DlqJobPayload {
  event: EventDto;
  sourceQueue: string;
  sourceJobId?: string;
  attemptsMade: number;
  maxAttempts: number;
  failedReason: string;
  failedAt: string;
  replayCount: number;
  maxReplayCount: number;
  replayedAt?: string;
}

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
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<ShipmentDocument>,
    @InjectQueue(DLQ_QUEUE)
    private readonly dlqQueue: Queue<DlqJobPayload>,
  ) {
    super();
  }

  async process(job: Job<EventDto>) {
    const event = job.data;
    const existingEventLog = await this.eventLogModel
      .findOne({ eventId: event.eventId })
      .lean()
      .exec();
    if (existingEventLog?.status === EventStatus.PROCESSED) {
      console.log('job skipped: event already processed', {
        eventId: event.eventId,
        jobId: job.id,
      });
      return;
    }

    await this.eventLogModel
      .updateOne(
        { eventId: event.eventId },
        {
          $setOnInsert: { eventId: event.eventId },
          $set: { status: EventStatus.CREATED, lastError: null },
          $inc: { attempts: 1 },
        },
        { upsert: true },
      )
      .exec();

    await this.shipmentModel
      .updateOne(
        { shipmentId: event.shipmentId, orderId: event.orderId },
        {
          $setOnInsert: {
            shipmentId: event.shipmentId,
            orderId: event.orderId,
            status: EventStatus.CREATED,
            metadata: {},
          },
        },
        { upsert: true },
      )
      .exec();

    await this.shipmentModel
      .findOne({ shipmentId: event.shipmentId, orderId: event.orderId })
      .lean()
      .exec();

    console.log('job start processing', job.id);
    await this.webhookService.routingEvent(job.data);
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job<EventDto>) {
    await this.eventLogModel
      .updateOne(
        { eventId: job.data.eventId },
        {
          $set: {
            status: EventStatus.PROCESSED,
            lastError: null,
            processedAt: new Date(),
          },
        },
      )
      .exec();

    await this.shipmentModel
      .updateOne(
        { shipmentId: job.data.shipmentId, orderId: job.data.orderId },
        { $set: { status: EventStatus.PROCESSED } },
      )
      .exec();
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<EventDto> | undefined, error: Error) {
    if (!job?.data) {
      console.log('job is failed but payload is missing');
      return;
    }

    console.log('job is failed', job.id);
    await this.eventLogModel
      .updateOne(
        { eventId: job.data.eventId },
        {
          $set: {
            status: EventStatus.FAILED,
            lastError: error.message,
          },
        },
      )
      .exec();

    await this.shipmentModel
      .updateOne(
        { shipmentId: job.data.shipmentId, orderId: job.data.orderId },
        { $set: { status: EventStatus.FAILED } },
      )
      .exec();

    const maxAttempts = Number(job.opts.attempts ?? 1);
    const isTerminalFailure = job.attemptsMade >= maxAttempts;
    if (!isTerminalFailure) {
      return;
    }

    const dlqJobId = `dlq-event-${job.data.eventId}`;
    try {
      const existingDlqJob = await this.dlqQueue.getJob(dlqJobId);
      const previousReplayCount = Number(
        existingDlqJob?.data &&
          typeof existingDlqJob.data === 'object' &&
          typeof existingDlqJob.data.replayCount === 'number'
          ? existingDlqJob.data.replayCount
          : 0,
      );
      if (existingDlqJob) {
        await existingDlqJob.remove();
      }

      const dlqPayload: DlqJobPayload = {
        event: job.data,
        sourceQueue: job.queueName,
        sourceJobId: job.id ? String(job.id) : undefined,
        attemptsMade: job.attemptsMade,
        maxAttempts,
        failedReason: error.message,
        failedAt: new Date().toISOString(),
        replayCount: previousReplayCount,
        maxReplayCount: DLQ_MAX_AUTO_REPLAYS,
      };

      const autoReplayEnabled = previousReplayCount < DLQ_MAX_AUTO_REPLAYS;
      await this.dlqQueue.add(job.data.eventId, dlqPayload, {
        jobId: dlqJobId,
        ...(autoReplayEnabled
          ? { delay: DLQ_AUTO_REPLAY_DELAY_MS }
          : undefined),
      });
    } catch (dlqError) {
      const message =
        dlqError instanceof Error ? dlqError.message : 'Unknown DLQ error';
      console.error('failed to handoff job to DLQ', {
        sourceJobId: job.id,
        dlqJobId,
        error: message,
      });
    }
  }
}
