import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PROFESSIONAL_TITLES } from '../../../professionals/constants/professional-titles';

export class AdminUpdateProfessionalProfileDto {
  @ApiPropertyOptional({ example: 'María' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'García' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ example: 'maria_g' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({
    example: 'Lic.',
    enum: PROFESSIONAL_TITLES,
    description: 'Título profesional. Cadena vacía limpia el campo.',
  })
  @IsOptional()
  @IsString()
  @IsIn([...PROFESSIONAL_TITLES, ''])
  title?: string;

  @ApiPropertyOptional({ example: 'Hola, soy María...' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Habilita/inhabilita el cobro. Al habilitar (tras revisar el título subido) se marca como TITULO y se baja la bandera de revisión pendiente.',
  })
  @IsOptional()
  @IsBoolean()
  canCharge?: boolean;
}

