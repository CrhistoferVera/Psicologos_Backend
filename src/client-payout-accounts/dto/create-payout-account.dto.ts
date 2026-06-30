import { RefundMethod } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreatePayoutAccountDto {
  @IsEnum(RefundMethod)
  method: RefundMethod;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  // Transferencia bancaria
  @ValidateIf((o) => o.method === RefundMethod.BANK_TRANSFER)
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ValidateIf((o) => o.method === RefundMethod.BANK_TRANSFER)
  @IsString()
  @MaxLength(50)
  bankAccountNumber?: string;

  @ValidateIf((o) => o.method === RefundMethod.BANK_TRANSFER)
  @IsString()
  @MaxLength(100)
  bankAccountHolder?: string;

  // Crypto
  @ValidateIf((o) => o.method === RefundMethod.CRYPTO)
  @IsString()
  @MaxLength(200)
  cryptoAddress?: string;

  @ValidateIf((o) => o.method === RefundMethod.CRYPTO)
  @IsString()
  @MaxLength(20)
  cryptoCurrency?: string;

  @ValidateIf((o) => o.method === RefundMethod.CRYPTO)
  @IsString()
  @MaxLength(50)
  cryptoNetwork?: string;
}
