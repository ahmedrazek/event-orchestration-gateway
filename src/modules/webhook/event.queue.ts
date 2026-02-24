import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EVENT_QUEUE } from './event-queue.constant';
import { InjectModel } from '@nestjs/mongoose';
import { EventLog, EventLogDocument } from './schema/event-log.schema';
import { Model } from 'mongoose';
import { Shipment, ShipmentDocument } from './schema/shipment.schema';
import { EventDto, EventStatus } from './dtos/event.dto';
@Injectable()
export class EventQueue {
  constructor(
    @InjectQueue(EVENT_QUEUE) private readonly queue: Queue,
    @InjectModel(EventLog.name)
    private readonly eventLogModel: Model<EventLogDocument>,
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<ShipmentDocument>,
  ) {}

  async addEventToQueue(event: EventDto) {
    const jobId = `event-${event.eventId}-${event.status}`;
    const existingJob = await this.queue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'delayed') {
        await this.eventLogModel.updateOne(
          { eventId: event.eventId },
          {
            $set: { status: 'created', $inc: { attempts: 1 }, lastError: null },
          },
        );
        await existingJob.remove();
      } else if (state === 'active') {
        return {
          jobId: existingJob.id,
          status: 'Already processing',
          message: 'A job with this ID is currently being processed',
        };
      } else if (state === 'failed') {
        await this.eventLogModel.updateOne(
          { eventId: event.eventId },
          { $set: { status: 'failed', attempts: 0, lastError: null } },
        );
        await existingJob.remove();
      }
    }
    await this.eventLogModel.updateOne(
      { eventId: event.eventId },
      {
        $set: {
          status: event.status,
          $inc: {
            attempts: 1,
          },
          lastError: null,
        },
      },
      { upsert: true },
    );
    if (event.status === EventStatus.CREATED) {
      const existingShipment = await this.shipmentModel.findOne({
        shipmentId: event.shipmentId,
        orderId: event.orderId,
      });
      if (!existingShipment) {
        await this.shipmentModel.create({
          shipmentId: event.shipmentId,
          orderId: event.orderId,
          status: EventStatus.CREATED,
        });
      }
    }
    const job = await this.queue.add(event.eventId, event, {
      jobId: jobId,
    });
    return {
      jobId: job.id,
      status: 'Queued',
      message: 'Event is being processed',
    };
  }
}
