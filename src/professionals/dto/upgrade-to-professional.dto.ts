import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { VerificationDocType } from '@prisma/client';

// Datos para que una cuenta EXISTENTE (ya autenticada) active su capacidad
// profesional. No incluye email/password/country: ya viven en la cuenta.
export class UpgradeToProfessionalDto {
  @ApiProperty({ example: 'camila_psicologa' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({
    example: 'Psicologa clinica con enfoque cognitivo conductual.',
    required: false,
  })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiProperty({ example: '1995-06-15' })
  @IsDateString()
  @IsNotEmpty()
  dateOfBirth: string;

  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  cedula: string;

  @ApiProperty({
    enum: VerificationDocType,
    example: 'TITULO',
    description:
      'Documento con el que se verifica. CI => solo sesiones gratuitas; TITULO o MATRICULA => puede cobrar.',
  })
  @IsEnum(VerificationDocType)
  verificationDocType: VerificationDocType;
}
