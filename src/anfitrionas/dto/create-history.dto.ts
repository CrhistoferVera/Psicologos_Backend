import { IsString, IsInt, IsEnum, IsOptional, Min, IsUrl } from 'class-validator';
import { MediaType } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class CreateHistoryDto {
    @ApiProperty({ description: 'URL de la imagen o video en Cloudinary' })
    @IsUrl() // Valida que sea una URL real
    mediaUrl: string;

    @ApiProperty({ enum: MediaType, description: 'Tipo de archivo: IMAGE o VIDEO' })
    @IsEnum(MediaType) // Solo acepta los valores de tu Enum de Prisma
    mediaType: MediaType;

    @ApiProperty({ description: 'ID público de Cloudinary para gestión de archivos' })
    @IsString()
    @IsOptional()
    publicId?: string;

    @ApiProperty({ description: 'Precio en créditos para ver la historia', default: 0 })
    @IsInt() // Asegura que sea un número entero como definimos en Prisma
    @Min(0)  // No permitimos precios negativos, ¡negocios son negocios!
    priceCredits: number;
}