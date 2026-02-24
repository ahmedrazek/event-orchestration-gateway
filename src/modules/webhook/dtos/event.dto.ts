import {
  IsString,
  IsObject,
  IsOptional,
  IsNotEmpty,
  IsEnum,
} from 'class-validator';

export enum EventStatus {
  CREATED = 'created',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

export class EventDto {
  @IsNotEmpty()
  @IsString()
  eventId: string;

  @IsNotEmpty()
  @IsEnum(EventStatus)
  status: EventStatus;

  @IsNotEmpty()
  @IsString()
  shipmentId: string;

  @IsNotEmpty()
  @IsString()
  orderId: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;
}
