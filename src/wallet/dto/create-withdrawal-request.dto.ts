import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateWithdrawalRequestDto {
  @ApiProperty({ example: 75, description: 'Creditos a retirar' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  credits: number;

  @ApiProperty({ example: '123', description: 'ID de la cuenta bancaria' })
  @IsString()
  @IsNotEmpty()
  bankAccountId: string;

  @ApiPropertyOptional({ example: 'BOB', description: 'Moneda de retiro: BOB o USD' })
  @IsOptional()
  @IsString()
  @IsIn(['BOB', 'USD'])
  currency?: 'BOB' | 'USD';
}
