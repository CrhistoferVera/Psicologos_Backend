import { IsEnum, IsInt, Min } from 'class-validator';
import { ServiceType } from '@prisma/client';

export class UpsertServicePriceDto {
  
  @IsEnum(ServiceType)
  serviceType: ServiceType;

  @IsInt()
  @Min(1)
  price: number;
}
