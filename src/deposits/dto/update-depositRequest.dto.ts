import { IsOptional, IsNumber, Min, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

//para cuando el deposito fue cancelado por el administrador
export class UpdateDepositRequestDto {

    @ApiProperty({ description:"url de la imagen del comprobante de deposito" })
    @IsOptional()
    @IsString()
    receiptUrl?: string;

    @ApiProperty({ description:"public id de la imagen en cloudinary" })
    @IsOptional()
    @IsString()
    receiptPublicId?: string;
}