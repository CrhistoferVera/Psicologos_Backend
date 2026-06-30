import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SetImmediateAvailabilityDto {
  @ApiProperty({ example: 30, description: 'Duración de la sesión en minutos' })
  @IsInt()
  @Min(1)
  durationMinutes: number;

  @ApiPropertyOptional({ example: 150, description: 'Precio en bolivianos' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  priceBob?: number;

  @ApiPropertyOptional({ example: 21.5, description: 'Precio en USD (para psicólogos extranjeros)' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  priceUsd?: number;

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
