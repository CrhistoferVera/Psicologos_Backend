import { IsBoolean, IsEmail, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ProfessionalReviewStatus } from '@prisma/client';

export class UpdateAnfitrionaDto {
    @ApiProperty({
        example: true,
        description: 'Estado de cuenta de un usuario (true: Activo / false: Suspendido)',
        required: true,
    })
    @IsBoolean({ message: 'El estado debe ser un valor booleano (true o false)' })
    @IsNotEmpty({ message: 'El campo isActive es obligatorio para esta operacion' })
    isActive: boolean;

    @ApiPropertyOptional({ enum: ProfessionalReviewStatus, description: 'Estado de revision profesional' })
    @IsOptional()
    @IsEnum(ProfessionalReviewStatus)
    reviewStatus?: ProfessionalReviewStatus;

    @ApiPropertyOptional({ description: 'Observacion administrativa para revision/rechazo' })
    @IsOptional()
    @IsString()
    reviewNotes?: string;
}

export class EditAnfitrionaDto {
    @ApiProperty({ example: '59171234567', description: 'Numero de telefono con codigo de pais', required: false })
    @IsOptional()
    @IsString()
    phoneNumber?: string;

    @ApiProperty({ example: 'camila_princ', description: 'Nombre de usuario unico', required: false })
    @IsOptional()
    @IsString()
    username?: string;

    @ApiProperty({ example: 'Conversaciones profesionales', description: 'Descripcion del perfil', required: false })
    @IsOptional()
    @IsString()
    bio?: string;

    @ApiProperty({ example: 10, description: 'Creditos por conversacion', required: false })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Type(() => Number)
    rateCredits?: number;

    @ApiProperty({ example: 'camila@gmail.com', description: 'Correo electronico', required: false })
    @IsOptional()
    @IsEmail({}, { message: 'El email no tiene un formato valido' })
    email?: string;
}
