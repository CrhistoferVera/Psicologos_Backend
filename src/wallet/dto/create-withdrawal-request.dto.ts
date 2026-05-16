import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { WithdrawalMethod } from '@prisma/client';

export class CreateWithdrawalRequestDto {
  @ApiProperty({ example: 75, description: 'Créditos a retirar' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  credits: number;

  @ApiPropertyOptional({
    example: 'BANK_TRANSFER',
    enum: WithdrawalMethod,
    description: 'Método de retiro: BANK_TRANSFER o CRYPTO',
  })
  @IsOptional()
  @IsEnum(WithdrawalMethod)
  method?: WithdrawalMethod;

  @ApiPropertyOptional({ example: 'BOB', description: 'Moneda de retiro: BOB o USD' })
  @IsOptional()
  @IsString()
  @IsIn(['BOB', 'USD'])
  currency?: 'BOB' | 'USD';

  // ── BANK_TRANSFER ────────────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: '123', description: 'ID de la cuenta bancaria (requerido si method = BANK_TRANSFER)' })
  @ValidateIf((o) => !o.method || o.method === WithdrawalMethod.BANK_TRANSFER)
  @IsString()
  @IsNotEmpty({ message: 'El ID de cuenta bancaria es requerido para retiros bancarios.' })
  bankAccountId?: string;

  // ── CRYPTO ───────────────────────────────────────────────────────────────────

  @ApiPropertyOptional({
    example: '0x742d35Cc6634C0532925a3b8D4C9C3',
    description: 'Dirección del wallet crypto (requerido si method = CRYPTO)',
  })
  @ValidateIf((o) => o.method === WithdrawalMethod.CRYPTO)
  @IsString()
  @IsNotEmpty({ message: 'La dirección del wallet crypto es requerida.' })
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'La dirección crypto debe ser una dirección válida (0x seguido de 40 caracteres hexadecimales).',
  })
  @MaxLength(100)
  cryptoAddress?: string;

  @ApiPropertyOptional({
    example: 'USDT',
    description: 'Criptomoneda (requerido si method = CRYPTO)',
  })
  @ValidateIf((o) => o.method === WithdrawalMethod.CRYPTO)
  @IsString()
  @IsNotEmpty({ message: 'La criptomoneda es requerida.' })
  @IsIn(['USDT', 'BNB', 'BTC', 'ETH'], { message: 'Criptomoneda no soportada.' })
  cryptoCurrency?: string;

  @ApiPropertyOptional({
    example: 'BEP20',
    description: 'Red blockchain (requerido si method = CRYPTO)',
  })
  @ValidateIf((o) => o.method === WithdrawalMethod.CRYPTO)
  @IsString()
  @IsNotEmpty({ message: 'La red blockchain es requerida.' })
  @IsIn(['BEP20', 'ERC20', 'TRC20'], { message: 'Red blockchain no soportada.' })
  cryptoNetwork?: string;
}
