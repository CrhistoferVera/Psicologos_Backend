import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateImmediateBookingDto {
  @ApiProperty({ description: 'ID del psicólogo que ofrece atención inmediata' })
  @IsUUID()
  professionalId: string;
}
