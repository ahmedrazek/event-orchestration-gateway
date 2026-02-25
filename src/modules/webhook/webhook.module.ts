import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { SignatureGuard } from 'src/guards/signature.guard';
import { SignatureService } from 'src/utils/signature.service';
import { EventQueue } from './event.queue';
import { EVENT_QUEUE } from './event-queue.constant';
import { MongooseModule } from '@nestjs/mongoose';
import { EventLogSchema } from './schema/event-log.schema';
import { ShipmentSchema } from './schema/shipment.schema';
import { EventProcessor } from './event.process';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: 'EventLog',
        schema: EventLogSchema,
      },
      {
        name: 'Shipment',
        schema: ShipmentSchema,
      },
    ]),
    BullModule.registerQueue({
      name: EVENT_QUEUE,
      defaultJobOptions: {
        removeOnComplete: true,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 3000,
        },
      },
    }),
  ],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    SignatureGuard,
    SignatureService,
    EventQueue,
    EventProcessor,
  ],
})
export class WebhookModule {}
