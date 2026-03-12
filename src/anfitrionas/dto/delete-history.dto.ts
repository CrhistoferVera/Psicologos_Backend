import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DeleteHistoryDto {
    @ApiProperty({ description: 'ID de la historia en la base de datos' })
    @IsString() 
    @IsNotEmpty()
    id: string;

    @ApiProperty({ description: 'Id unico de cloudinary para eliminar el archivo fisico' })
    @IsString()
    @IsNotEmpty()
    publicId: string;
}