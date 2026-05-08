import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class AvailableSlotsQueryDto {
  @ApiProperty()
  @IsUUID()
  sessionOfferingId: string;

  @ApiProperty({ example: '2026-05-10' })
  @IsDateString()
  date: string;

  @ApiProperty({ required: false, example: 'America/La_Paz' })
  @IsOptional()
  @IsString()
  timezone?: string;
}
