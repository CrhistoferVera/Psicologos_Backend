import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class AddBankAccountDto {
  @ApiProperty({ example: 1, description: 'ID del banco seleccionado' })
  @IsInt()
  @Min(1)
  bankId: number;

  @ApiProperty({ example: '12345678901234', description: 'Numero de cuenta bancaria' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  accountNumber: string;

  @ApiPropertyOptional({ example: 'Juan Perez', description: 'Nombre del titular de la cuenta' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountHolderName?: string;
}
