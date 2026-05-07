import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateSessionOfferingDto {
  @ApiProperty({ example: 'Sesion individual' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ example: 'Sesion de seguimiento individual' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 45 })
  @IsInt()
  @Min(1)
  durationMinutes: number;

  @ApiProperty({ example: 200 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  priceBob: number;
}
