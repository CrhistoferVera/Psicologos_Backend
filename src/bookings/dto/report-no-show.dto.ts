import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReportNoShowDto {
  @ApiPropertyOptional({ example: 'El psicólogo no se conectó en ningún momento' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
