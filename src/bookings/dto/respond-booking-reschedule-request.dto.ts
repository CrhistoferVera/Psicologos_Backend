import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RespondBookingRescheduleRequestDto {
  @ApiPropertyOptional({ example: 'De acuerdo, confirmo el cambio de horario.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  responseNote?: string;
}
