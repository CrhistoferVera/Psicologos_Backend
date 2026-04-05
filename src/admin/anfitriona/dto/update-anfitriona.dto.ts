import { IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateAnfitrionaDto {
    @ApiProperty({ 
        example: true, 
        description: 'Estado de cuenta de un usuario (true: Activo / false: Suspendido)', 
        required: true 
    })
    @IsBoolean({ message: 'El estado debe ser un valor booleano (true o false)' })
    @IsNotEmpty({ message: 'El campo isActive es obligatorio para esta operación' })
    isActive: boolean;
}

export class EditAnfitrionaDto {
    @ApiProperty({ example: '59171234567', description: 'Número de teléfono con código de país', required: false })
    @IsOptional()
    @IsString()
    phoneNumber?: string;

    @ApiProperty({ example: 'camila_princ', description: 'Nombre de usuario único', required: false })
    @IsOptional()
    @IsString()
    username?: string;

    @ApiProperty({ example: 'Conversaciones alegres 🌸', description: 'Descripción del perfil', required: false })
    @IsOptional()
    @IsString()
    bio?: string;

    @ApiProperty({ example: 10, description: 'Créditos por conversación', required: false })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Type(() => Number)
    rateCredits?: number;

    @ApiProperty({ example: 'camila@gmail.com', description: 'Correo electrónico', required: false })
    @IsOptional()
    @IsEmail({}, { message: 'El email no tiene un formato válido' })
    email?: string;
}
