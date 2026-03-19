import { ApiProperty } from '@nestjs/swagger';
import {
    IsUUID, IsOptional, IsNumber, Min
} from 'class-validator';

export class CreateWalletDto {
    @ApiProperty({
        description: 'ID del usuario dueño de la billetera',
        example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',

    })
    @IsUUID('4', { message: 'El userId debe ser un UUID valido' })
    userId: string;

    @ApiProperty({
        description: 'Balance inicial de la billetera (opcional)',
        example: 0,
        required: false,
    })
    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 }, { message: 'El balance debe ser un número válido' })
    @Min(0, { message: 'El balance no puede ser negativo' })
    balance?: number;
}
