import { IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DepositStatus } from '@prisma/client';

//Obligamos al Admin a poner una razón si decide rechazar.
export class HandleDepositStatusDto {
    @ApiProperty({
        enum: DepositStatus,
        description: 'Estado al que se actualizará la solicitud de depósito',
    })
    @IsEnum(DepositStatus)
    @IsNotEmpty()
    status: DepositStatus;

    // Si el status es REJECTED, el motivo es obligatorio
    @ApiProperty({
        required: false,
        description: 'Razón del rechazo, solo requerida si el estado es REJECTED',
    })
    @ValidateIf(o => o.status === 'REJECTED')
    @IsString()
    @IsNotEmpty({ message: 'Debes proporcionar una razón para el rechazo' })
    rejectionReason?: string;
}