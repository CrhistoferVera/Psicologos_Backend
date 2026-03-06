import { IsBoolean, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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