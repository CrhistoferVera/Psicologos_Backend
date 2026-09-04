import { IsBoolean, IsEmail, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProfessionalReviewStatus } from '@prisma/client';

export class UpdateProfessionalDto {
    @ApiProperty({
        example: true,
        description: 'Estado de cuenta de un usuario (true: Activo / false: Suspendido)',
        required: true,
    })
    @IsBoolean({ message: 'El estado debe ser un valor booleano (true o false)' })
    @IsNotEmpty({ message: 'El campo isActive es obligatorio para esta operacion' })
    isActive!: boolean;

    @ApiPropertyOptional({ enum: ProfessionalReviewStatus, description: 'Estado de revision profesional' })
    @IsOptional()
    @IsEnum(ProfessionalReviewStatus)
    reviewStatus?: ProfessionalReviewStatus;

    @ApiPropertyOptional({ description: 'Observacion administrativa para revision/rechazo' })
    @IsOptional()
    @IsString()
    reviewNotes?: string;
}

export class UpdateKycDocDto {
    @ApiProperty({ example: 'idDocUrl', description: 'Campo a actualizar', enum: ['idDocUrl', 'kycVideoUrl', 'matriculaUrl', 'tituloProfesionalUrl'] })
    @IsString()
    @IsIn(['idDocUrl', 'kycVideoUrl', 'matriculaUrl', 'tituloProfesionalUrl'])
    field!: 'idDocUrl' | 'kycVideoUrl' | 'matriculaUrl' | 'tituloProfesionalUrl';

    @ApiProperty({ example: 'https://res.cloudinary.com/...', description: 'URL del documento' })
    @IsString()
    @IsUrl()
    url!: string;
}

export class EditProfessionalDto {
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

    @ApiProperty({ example: 'camila@gmail.com', description: 'Correo electronico', required: false })
    @IsOptional()
    @IsEmail({}, { message: 'El email no tiene un formato valido' })
    email?: string;
}

