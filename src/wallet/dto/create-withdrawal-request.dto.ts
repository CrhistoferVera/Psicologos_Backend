import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateWithdrawalRequestDto {
  @ApiProperty({ example: 75, description: 'Creditos a retirar' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  credits: number;

  @ApiProperty({ example: '123', description: 'ID de la cuenta bancaria' })
  @IsString()
  @IsNotEmpty()
  bankAccountId: string;
}
