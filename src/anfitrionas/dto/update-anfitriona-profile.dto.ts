import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
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

  @ApiPropertyOptional({ example: 'Conversaciones alegres 🌸' })
  @IsString()
  @IsOptional()
  bio?: string;

  @ApiPropertyOptional({ example: 10, description: 'Créditos por conversación' })
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
}
