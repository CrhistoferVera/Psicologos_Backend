import { ApiProperty } from '@nestjs/swagger';
import {
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    ValidateIf
} from 'class-validator';
import { WithdrawalStatus } from '@prisma/client';

export class UpdateWithdrawalRequetsDto {
    @ApiProperty({
        example: WithdrawalStatus.APPROVED,
        description: 'Nuevo estado de la solicitud de pago',
        enum: [WithdrawalStatus.APPROVED, WithdrawalStatus.REJECTED],
    })
    @IsEnum(WithdrawalStatus, {
        message: 'El estado debe ser APPROVED o REJECTED',
    })
    @IsNotEmpty()
    status: WithdrawalStatus;

    @ApiProperty({
        example: 'El comprobante no es legible o es falso',
        description: 'Motivo del rechazo (obligatorio si el estado es REJECTED)',
        required: false,
    })
    @ValidateIf((o) => o.status === WithdrawalStatus.REJECTED)
    @IsString()
    @IsNotEmpty({ message: 'Debe proporcionar un motivo para el rechazo de la solicitud' })
    rejectionReason?: string;

    // Campo ignorado en validación — el archivo llega por @UploadedFile() en el controller
    @IsOptional()
    receipt?: any;
}
