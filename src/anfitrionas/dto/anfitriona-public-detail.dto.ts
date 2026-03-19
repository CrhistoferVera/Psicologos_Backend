import { ApiProperty } from '@nestjs/swagger';
import { GalleryImagePublicDto } from './gallery-image.dto';

export class AnfitrionePublicDetailDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'Maria Lopez' })
  name: string;

  @ApiProperty({ example: 'maria_lopez' })
  username: string;

  @ApiProperty({
    example: 28,
    nullable: true,
    description: 'Edad calculada desde dateOfBirth',
  })
  age: number | null;

  @ApiProperty({ example: 'Conversaciones alegres 🌸✨', nullable: true })
  bio: string | null;

  @ApiProperty({
    example: 'https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg',
    nullable: true,
  })
  avatar: string | null;

  @ApiProperty({
    example: 'https://res.cloudinary.com/demo/image/upload/v1/img1.jpg',
    nullable: true,
    description: 'Primera imagen del perfil (para usar como portada/cover). Deriva de images[0].',
  })
  coverImage: string | null;

  @ApiProperty({
    type: [String],
    example: [
      'https://res.cloudinary.com/demo/image/upload/v1/img1.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1/img2.jpg',
    ],
    description: 'URLs planas de las imágenes visibles (compatibilidad hacia atrás).',
  })
  images: string[];

  @ApiProperty({
    type: [GalleryImagePublicDto],
    description:
      'Galería completa con metadata de premium. ' +
      'Usar este campo para renderizar imágenes normales vs bloqueadas.',
    example: [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/img1.jpg',
        isPremium: false,
        unlockCredits: null,
      },
      {
        id: '660e8400-e29b-41d4-a716-446655440111',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/img2.jpg',
        isPremium: true,
        unlockCredits: 30,
      },
    ],
  })
  galleryImages: GalleryImagePublicDto[];

  @ApiProperty({ example: 10, nullable: true, description: 'Créditos por conversación' })
  rateCredits: number | null;

  @ApiProperty({ example: true })
  isOnline: boolean;

  @ApiProperty({ example: 42, description: 'Total de likes recibidos' })
  likesCount: number;

  @ApiProperty({ example: false, description: 'Si el usuario autenticado ya dio like' })
  isLiked: boolean;
}
