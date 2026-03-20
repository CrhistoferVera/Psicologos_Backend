import { IsNotEmpty, IsOptional, IsString, IsUrl, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

//Para cuando el cliente elige el camino de pedir su dinero de vuelta.
export class RequestRefundDto {
    @ApiProperty({ description:"cuenta del cliente" })
    @ValidateIf(o => !o.clientQrUrl)
    @IsString()
    @IsNotEmpty({message:"debes proporcionar una cuenta o un QR"})
    clientAccount?: string;

    @ApiProperty({ description:"url del codigo qr del cliente" })
    @ValidateIf(o => !o.clientAccount)
    @IsString()
    @IsNotEmpty({message:"debes proporcionar una cuenta o un QR"})
    clientQrUrl?: string;

}