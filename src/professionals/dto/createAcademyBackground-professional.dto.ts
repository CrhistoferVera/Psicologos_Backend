import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateAcademyBackgroundDto {
    @IsString()
    titulo!: string;

    @IsString()
    institution!: string;

    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;

    @IsOptional()
    @IsString()
    diplomaUrl?: string;

    @IsOptional()
    @IsString()
    diplomaUrl_publicId?: string;
}
