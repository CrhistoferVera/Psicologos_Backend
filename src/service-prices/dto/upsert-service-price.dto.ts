import { IsEnum, IsNumber, Min } from 'class-validator';
import { ServiceType } from '@prisma/client';

export class UpsertServicePriceDto {

  @IsEnum(ServiceType)
  serviceType: ServiceType;

  @IsNumber()
  @Min(0.01)
  price: number;
}
