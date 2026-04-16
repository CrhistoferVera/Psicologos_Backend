import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAnfitrioneProfileDto {
  @ApiPropertyOptional({ example: 'Maria' })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Gonzalez' })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional({ example: 'maria_g' })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional({ example: 'Conversaciones profesionales.' })
  @IsString()
  @IsOptional()
  bio?: string;

  @ApiPropertyOptional({ example: 10, description: 'Creditos por conversacion' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  rateCredits?: number;

  @ApiPropertyOptional({ example: true, description: 'Estado de disponibilidad visible en el feed' })
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  @IsOptional()
  isOnline?: boolean;

  @ApiPropertyOptional({
    example: { monFri: '09:00 - 19:00', sat: '09:00 - 14:00', sun: 'No disponible' },
    description: 'Disponibilidad semanal del profesional',
  })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  })
  @IsOptional()
  @IsObject()
  availability?: Record<string, unknown>;
}
