import { IsUUID, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ToggleSavedAnfitrianaDto {
    @ApiProperty({ description: 'ID de la anfitriona a guardar o quitar' })
    @IsUUID()
    @IsNotEmpty()
    anfitrionaId: string;
}
