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

  @ApiPropertyOptional({ example: 2.5, description: 'Valor de 1 crédito expresado en Bs.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  creditValueBs?: number;

  @ApiPropertyOptional({ example: 6.96, description: 'Tipo de cambio USD → Bs para retiros en dólares.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  usdExchangeRate?: number;

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

  @ApiPropertyOptional({ example: 1, description: 'Cantidad minima de compras validas para que un referido sea valido (recargas aprobadas + sesiones pagadas, >= 0).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  referralValidPurchasesRequired?: number;

  @ApiPropertyOptional({ example: 10, description: 'Cantidad de referidos validos requeridos para activar un beneficio.' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  referralThreshold?: number;

  @ApiPropertyOptional({ example: 5, description: 'Porcentaje de descuento para beneficio de cliente (0-100).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  referralClientDiscountPercent?: number;

  @ApiPropertyOptional({ example: 10, description: 'Cantidad de sesiones con descuento por ciclo de beneficio cliente.' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  referralClientDiscountSessions?: number;

  @ApiPropertyOptional({ example: 5, description: 'Porcentaje de recompensa permanente para referente profesional (0-100).' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  referralProfessionalRewardPercent?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  paymentsEnabled?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  withdrawalsEnabled?: boolean;
}
