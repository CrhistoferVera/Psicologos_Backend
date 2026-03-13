import { IsInt, Min, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateHistoryDto {
    @ApiProperty({ description: 'Precio en créditos para ver la historia', default: 0 })
    @Type(() => Number)
    @IsInt({ message: 'El precio debe ser un número entero' })
    @Min(0, { message: 'El precio no puede ser negativo' })
    priceCredits: number;

    @IsOptional() 
    file?: any;
}