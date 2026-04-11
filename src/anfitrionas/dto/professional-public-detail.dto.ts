import { ApiProperty } from '@nestjs/swagger';
import { SpecialtySummaryDto } from './professional-public-list.dto';

export class ProfessionalPublicDetailDto {
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

  @ApiProperty({ example: 'Psicologa clinica con enfoque en ansiedad y autoestima', nullable: true })
  bio: string | null;

  @ApiProperty({
    example: 'https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg',
    nullable: true,
  })
  avatar: string | null;

  @ApiProperty({
    example: 'https://res.cloudinary.com/demo/image/upload/v1/img1.jpg',
    nullable: true,
    description: 'Imagen principal del perfil (cover)',
  })
  coverImage: string | null;

  @ApiProperty({
    type: [String],
    example: [
      'https://res.cloudinary.com/demo/image/upload/v1/img1.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1/img2.jpg',
    ],
    description: 'Imagenes visibles del perfil',
  })
  images: string[];

  @ApiProperty({ example: 10, nullable: true, description: 'Creditos por conversacion' })
  rateCredits: number | null;

  @ApiProperty({ example: true })
  isOnline: boolean;

  @ApiProperty({
    type: [SpecialtySummaryDto],
    description: 'Especialidades activas del profesional',
    example: [{ id: '550e8400-e29b-41d4-a716-446655440001', name: 'Ansiedad', slug: 'ansiedad' }],
  })
  specialties: SpecialtySummaryDto[];
}
