import { IsBoolean, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGalleryImageDto {
  @ApiProperty({
    example: false,
    description:
      'Si es true la imagen es premium y requiere créditos para desbloquearla. ' +
      'Si es false la imagen es pública y gratuita.',
    default: false,
  })
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isPremium: boolean = false;

  @ApiPropertyOptional({
    example: 30,
    description:
      'Créditos requeridos para desbloquear la imagen. ' +
      'Obligatorio y mayor a 0 cuando isPremium es true. ' +
      'Se ignora si isPremium es false.',
  })
  @ValidateIf((o) => o.isPremium === true)
  @IsInt({ message: 'unlockCredits debe ser un número entero.' })
  @Min(1, { message: 'unlockCredits debe ser mayor a 0 cuando la imagen es premium.' })
  @Type(() => Number)
  @IsOptional()
  unlockCredits?: number;
}
