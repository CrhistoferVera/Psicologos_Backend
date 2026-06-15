import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SetImmediateAvailabilityDto {
  @ApiProperty({ example: 30, description: 'Duración de la sesión en minutos' })
  @IsInt()
  @Min(1)
  durationMinutes: number;

  @ApiProperty({ example: 150, description: 'Precio en bolivianos' })
  @IsNumber()
  @Min(0.01)
  priceBob: number;

  @ApiProperty({ example: 60, description: 'Cuántos minutos estará activo el modo inmediato' })
  @IsInt()
  @Min(1)
  activeForMinutes: number;

  @ApiPropertyOptional({ example: 'Disponible para crisis de ansiedad', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}
