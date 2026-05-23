import { ApiPropertyOptional } from '@nestjs/swagger';
import { BookingRescheduleRequestStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class BookingRescheduleListQueryDto {
  @ApiPropertyOptional({ enum: BookingRescheduleRequestStatus })
  @IsOptional()
  @IsEnum(BookingRescheduleRequestStatus)
  status?: BookingRescheduleRequestStatus;
}
