import { IsNotEmpty, IsOptional, IsString, IsUUID, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateDepositRequestDto {
    @ApiProperty({ description: 'id del paquete que se adquiria' })
    @IsUUID()
    @IsNotEmpty()
    packageId: string;

    @ApiProperty({ description: 'id del metodo de pago que se utilizara' })
    @IsUUID()
    @IsNotEmpty()
    paymentMethodId: string;
}