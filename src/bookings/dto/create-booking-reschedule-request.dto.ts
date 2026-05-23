import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBookingRescheduleRequestDto {
  @ApiProperty({ example: '2026-05-25T15:00:00.000Z' })
  @IsDateString()
  proposedStartAt: string;

  @ApiPropertyOptional({ example: 'America/La_Paz' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  proposedTimezone?: string;

  @ApiPropertyOptional({ example: 'Necesito adelantar la cita' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
