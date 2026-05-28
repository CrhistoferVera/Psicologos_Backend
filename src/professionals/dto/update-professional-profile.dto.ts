import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PROFESSIONAL_TITLES } from '../constants/professional-titles';

export class EducationEntryDto {
  @IsString()
  id!: string;

  @IsString()
  degree!: string;

  @IsString()
  institution!: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1900)
  @Max(2100)
  year!: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}

export class UpdateProfessionalProfileDto {
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

  @ApiPropertyOptional({
    example: 'Lic.',
    enum: PROFESSIONAL_TITLES,
    description: 'Título profesional (Dr., Dra., Lic., Lic.ª, Mg., MsC., PhD). Cadena vacía limpia el campo.',
  })
  @IsString()
  @IsOptional()
  @IsIn([...PROFESSIONAL_TITLES, ''])
  title?: string;

  @ApiPropertyOptional({ example: 'Conversaciones profesionales.' })
  @IsString()
  @IsOptional()
  bio?: string;

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

  @ApiPropertyOptional({ example: ['Español', 'Inglés'], description: 'Idiomas que habla el profesional' })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return value; }
    }
    return value;
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({ description: 'Formación académica del profesional' })
  @Transform(({ value }) => {
    let arr: unknown = value;
    if (typeof value === 'string') {
      try {
        arr = JSON.parse(value);
      } catch {
        return value;
      }
    }
    if (!Array.isArray(arr)) return arr;
    return (arr as Record<string, unknown>[]).map((item) => {
      const entry = new EducationEntryDto();
      Object.assign(entry, item);
      return entry;
    });
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EducationEntryDto)
  education?: EducationEntryDto[];
}
