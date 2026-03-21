import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGalleryImageDto {
  @ApiPropertyOptional({ example: true, description: 'Si la imagen es premium (bloqueada por créditos)' })
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  @IsOptional()
  isPremium?: boolean;

  @ApiPropertyOptional({ example: 30, description: 'Créditos para desbloquear. Requerido y > 0 si isPremium es true' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  unlockCredits?: number;

  @ApiPropertyOptional({ example: true, description: 'Si la imagen está visible en el perfil público' })
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  @IsOptional()
  isVisible?: boolean;

  @ApiPropertyOptional({ example: 0, description: 'Posición en la galería (menor = primero)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}
