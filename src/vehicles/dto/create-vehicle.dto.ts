import { IsString, IsNotEmpty, IsInt, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateVehicleDto {
  @ApiProperty({ example: 'ABC-123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  plate: string; // Placa del vehículo

  @ApiProperty({ example: 'Toyota' })
  @IsString()
  @IsNotEmpty()
  brand: string; // Marca

  @ApiProperty({ example: 'Hilux' })
  @IsString()
  @IsNotEmpty()
  model: string;

  @ApiProperty({ example: 2024 })
  @IsInt()
  year: number;

  @ApiProperty({ example: 'id-del-propietario' })
  @IsString()
  @IsNotEmpty()
  ownerId: string;
}