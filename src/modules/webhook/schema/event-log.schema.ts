import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type EventLogDocument = HydratedDocument<EventLog>;

@Schema({ timestamps: true })
export class EventLog {
  @Prop({ required: true, unique: true, index: true })
  eventId: string;

  @Prop({ required: true, enum: ['created', 'processed', 'failed'] })
  status: 'created' | 'processed' | 'failed';

  @Prop({ default: 0 })
  attempts: number;

  @Prop()
  lastError?: string;

  @Prop()
  processedAt?: Date;
}

export const EventLogSchema = SchemaFactory.createForClass(EventLog);
