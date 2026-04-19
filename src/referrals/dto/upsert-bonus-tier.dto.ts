import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpsertBonusTierDto {
  @ApiPropertyOptional({ description: 'ID del tier (omitir para crear nuevo)' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Bronce' })
  @IsString()
  label: string;

  @ApiProperty({ example: 5, description: 'Mínimo de referidos activos para aplicar este bono' })
  @IsNumber()
  @Min(1)
  minActiveReferrals: number;

  @ApiProperty({ example: 0.5, description: 'Porcentaje adicional de bono (0-100)' })
  @IsNumber()
  @Min(0)
  bonusPercent: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
