import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional } from "class-validator";   

export class UpdateAcademyBackgroundDto {
    @ApiPropertyOptional({ example: 'Licenciatura en Psicología' })
    @IsOptional()
    titulo?: string;

    @ApiPropertyOptional({ example: 'Universidad de Sevilla' })
    @IsOptional()
    institution?: string;

    @ApiPropertyOptional({ example: '2020-01-01' })
    @IsOptional()
    startDate?: string;

    @ApiPropertyOptional({ example: '2024-01-01' })
    @IsOptional()
    endDate?: string;

    @ApiPropertyOptional({ example: 'https://example.com/diploma.pdf' })
    @IsOptional()
    diplomaUrl?: string;

    @ApiPropertyOptional({ example: 'public_id' })
    @IsOptional()
    diplomaUrl_publicId?: string;
}