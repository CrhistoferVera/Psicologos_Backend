import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateSessionDto {
  @ApiProperty({ example: 'Terapia de ansiedad', description: 'Titulo de la sesion' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 60, description: 'Duracion en minutos' })
  @IsInt()
  @Min(15)
  durationMinutes: number;

  @ApiProperty({ example: 150.00, description: 'Precio en bolivianos (Bs)' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  priceInBs: number;

  @ApiPropertyOptional({ example: 'Sesion enfocada en tecnicas de respiracion', description: 'Descripcion opcional' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
