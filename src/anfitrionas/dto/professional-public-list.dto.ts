import { ApiProperty } from '@nestjs/swagger';

export class SpecialtySummaryDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'Ansiedad' })
  name: string;

  @ApiProperty({ example: 'ansiedad' })
  slug: string;
}

export class ProfessionalPublicListItemDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'Maria Lopez' })
  name: string;

  @ApiProperty({ example: 'maria_lopez', nullable: true })
  username: string | null;

  @ApiProperty({
    example: 'https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg',
    nullable: true,
  })
  avatar: string | null;

  @ApiProperty({ example: 'Psicologa clinica enfocada en ansiedad y duelo', nullable: true })
  shortDescription: string | null;

  @ApiProperty({ example: 10, nullable: true, description: 'Creditos por conversacion' })
  rateCredits: number | null;

  @ApiProperty({
    example: 'https://res.cloudinary.com/demo/image/upload/v1/main.jpg',
    nullable: true,
    description: 'Imagen principal del perfil',
  })
  mainImage: string | null;

  @ApiProperty({
    type: [String],
    example: ['https://res.cloudinary.com/demo/image/upload/v1/main.jpg'],
    description: 'Imagenes visibles del perfil',
  })
  images: string[];

  @ApiProperty({ example: true })
  isOnline: boolean;

  @ApiProperty({
    type: [SpecialtySummaryDto],
    description: 'Especialidades activas del profesional',
    example: [{ id: '550e8400-e29b-41d4-a716-446655440001', name: 'Depresion', slug: 'depresion' }],
  })
  specialties: SpecialtySummaryDto[];
}

export class ProfessionalPublicListResponseDto {
  @ApiProperty({ type: [ProfessionalPublicListItemDto] })
  data: ProfessionalPublicListItemDto[];

  @ApiProperty({ example: 50, description: 'Total de profesionales activos' })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;
}
