import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateSystemConfigDto {
  @ApiPropertyOptional({ example: 50, description: 'Porcentaje de comisión de la plataforma (0-100).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  platformFeePercent?: number;

  @ApiPropertyOptional({ example: 1, description: 'Tipo de cambio créditos a moneda local.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  creditToSolesRate?: number;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  minAppVersion?: string;

  @ApiPropertyOptional({ example: 2.5, description: 'Porcentaje de ganancias del profesional referido que recibe el referente (0-100).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  referralPercentage?: number;

  @ApiPropertyOptional({ example: 10, description: 'Créditos de recompensa por referido válido (legado, no usar).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  referralRewardCredits?: number;

  @ApiPropertyOptional({ example: 0, description: 'Monto mínimo de depósito para validar referido.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  referralMinDepositAmount?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  referralEnabled?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  paymentsEnabled?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  withdrawalsEnabled?: boolean;
}
