import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Respuesta de GET /anfitrionas/me/gallery
 * Incluye todos los campos de gestión (isVisible, createdAt).
 */
export class GalleryImageDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({
    example: 'https://res.cloudinary.com/demo/image/upload/v1/gallery_1.jpg',
  })
  imageUrl: string;

  @ApiProperty({
    example: false,
    description: 'Si la imagen es premium (bloqueada por créditos).',
  })
  isPremium: boolean;

  @ApiPropertyOptional({
    example: 30,
    nullable: true,
    description: 'Créditos requeridos para desbloquear. null si la imagen es gratuita.',
  })
  unlockCredits: number | null;

  @ApiProperty({
    example: true,
    description: 'Si la imagen está visible en el perfil público.',
  })
  isVisible: boolean;

  @ApiProperty({ example: '2026-03-19T10:00:00.000Z' })
  createdAt: string;
}

/**
 * Shape de imagen en GET /anfitrionas/public/:id
 * No expone isVisible ni datos de gestión interna.
 */
export class GalleryImagePublicDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({
    example: 'https://res.cloudinary.com/demo/image/upload/v1/gallery_1.jpg',
    description:
      'URL de la imagen. Presente tanto para imágenes normales como premium. ' +
      'El frontend aplica el blur/overlay si isPremium es true.',
  })
  imageUrl: string;

  @ApiProperty({
    example: false,
    description: 'Si la imagen requiere créditos para desbloquearla.',
  })
  isPremium: boolean;

  @ApiPropertyOptional({
    example: 30,
    nullable: true,
    description:
      'Créditos requeridos para desbloquear. ' +
      'null si isPremium es false. ' +
      'Usar este valor para mostrar el badge de créditos en el overlay.',
  })
  unlockCredits: number | null;

  @ApiProperty({
    example: false,
    description:
      'Indica si el usuario autenticado ya desbloqueó esta imagen. ' +
      'Siempre false si la imagen no es premium o si la consulta es pública sin sesión. ' +
      'El frontend usa este campo para decidir si mostrar el overlay de lock o la imagen libre.',
  })
  isUnlockedByViewer: boolean;
}
