import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ShipmentDocument = HydratedDocument<Shipment>;

@Schema({ timestamps: true })
export class Shipment {
  @Prop({ required: true, unique: true })
  shipmentId: string;

  @Prop({ required: true })
  orderId: string;

  @Prop({ required: true })
  status: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const ShipmentSchema = SchemaFactory.createForClass(Shipment);
