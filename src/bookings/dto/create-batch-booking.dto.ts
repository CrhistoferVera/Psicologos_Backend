import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { CreateBookingDto } from './create-booking.dto';

export class CreateBatchBookingDto {
  @ApiProperty({ type: [CreateBookingDto], minItems: 1, maxItems: 3 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => CreateBookingDto)
  bookings: CreateBookingDto[];
}
