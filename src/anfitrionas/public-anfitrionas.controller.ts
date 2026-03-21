import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Request, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AnfitrioneService } from './anfitrionas.service';
import {
  AnfitrionePublicListResponseDto,
} from './dto/anfitriona-public-list.dto';
import { AnfitrionePublicDetailDto } from './dto/anfitriona-public-detail.dto';

@ApiTags('Anfitrionas - Público')
@Controller('anfitrionas/public')
export class PublicAnfitrioneController {
  constructor(private readonly service: AnfitrioneService) {}

  /**
   * GET /anfitrionas/public
   * Listado público de anfitrionas activas para la pantalla de feed del cliente.
   * No requiere autenticación; si hay token válido se puebla isLiked por item.
   */
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Listado público de anfitrionas',
    description:
      'Devuelve anfitrionas activas con perfil completo. ' +
      'Listo para reemplazar mock data del frontend (HU1).',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de anfitrionas',
    type: AnfitrionePublicListResponseDto,
    example: {
      data: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Maria Lopez',
          avatar: 'https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg',
          shortDescription: 'Conversaciones alegres 🌸✨',
          rateCredits: 10,
          mainImage: 'https://res.cloudinary.com/demo/image/upload/v1/main.jpg',
          images: ['https://res.cloudinary.com/demo/image/upload/v1/main.jpg'],
          isOnline: true,
        },
      ],
    },
  })
  findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Request() req,
  ): Promise<AnfitrionePublicListResponseDto> {
    const currentUserId: string | undefined =
      req.user?.id ?? req.user?.userId ?? req.user?.sub;
    return this.service.findAllPublic(Number(page), Number(limit), currentUserId);
  }

  /**
   * GET /anfitrionas/public/:id
   * Perfil público detallado de una anfitriona (HU2).
   * No requiere autenticación; si hay token válido se puebla isLiked.
   */
  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Perfil público de una anfitriona',
    description: 'Devuelve información pública detallada de una anfitriona activa (HU2).',
  })
  @ApiParam({ name: 'id', description: 'UUID del usuario anfitriona' })
  @ApiResponse({
    status: 200,
    description: 'Perfil de la anfitriona',
    type: AnfitrionePublicDetailDto,
    example: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Maria Lopez',
      username: 'maria_lopez',
      age: 28,
      bio: 'Conversaciones alegres 🌸✨',
      avatar: 'https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg',
      images: [
        'https://res.cloudinary.com/demo/image/upload/v1/img1.jpg',
        'https://res.cloudinary.com/demo/image/upload/v1/img2.jpg',
      ],
      rateCredits: 10,
      isOnline: true,
    },
  })
  @ApiResponse({ status: 404, description: 'Anfitriona no encontrada' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req,
  ): Promise<AnfitrionePublicDetailDto> {
    const currentUserId: string | undefined =
      req.user?.id ?? req.user?.userId ?? req.user?.sub;
    return this.service.findOnePublic(id, currentUserId);
  }

  /**
   * POST /anfitrionas/public/:id/gallery/:imageId/unlock
   * Desbloquea una imagen premium de la galería de una anfitriona.
   * Requiere autenticación con rol USER y saldo suficiente en la wallet.
   */
  @Post(':id/gallery/:imageId/unlock')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Desbloquear imagen premium',
    description:
      'Descuenta créditos del cliente y desbloquea la imagen premium de la galería. ' +
      'Si ya fue desbloqueada previamente devuelve alreadyUnlocked: true sin cobrar.',
  })
  @ApiParam({ name: 'id', description: 'UUID del usuario anfitriona' })
  @ApiParam({ name: 'imageId', description: 'UUID de la imagen a desbloquear' })
  @ApiResponse({
    status: 200,
    description: 'Imagen desbloqueada (o ya estaba desbloqueada)',
    schema: {
      example: {
        alreadyUnlocked: false,
        creditsSpent: 30,
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/img2.jpg',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Imagen no es premium / saldo insuficiente' })
  @ApiResponse({ status: 404, description: 'Anfitriona o imagen no encontrada' })
  unlockGalleryImage(
    @Param('id', ParseUUIDPipe) anfitrionaId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Request() req,
  ): Promise<{ alreadyUnlocked: boolean; creditsSpent: number; imageUrl: string }> {
    const userId: string | undefined =
      req.user?.id ?? req.user?.userId ?? req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('No se pudo identificar al usuario.');
    }
    return this.service.unlockGalleryImage(userId, anfitrionaId, imageId);
  }

  /**
   * POST /anfitrionas/public/:id/like
   * Alterna el like de un cliente a una anfitriona.
   * Requiere autenticación con rol USER.
   */
  @Post(':id/like')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiOperation({ summary: 'Dar/quitar like a una anfitriona' })
  @ApiParam({ name: 'id', description: 'UUID del usuario anfitriona' })
  @ApiResponse({ status: 201, description: '{ liked: boolean, likesCount: number }' })
  toggleLike(
    @Param('id', ParseUUIDPipe) anfitrionaId: string,
    @Request() req,
  ): Promise<{ liked: boolean; likesCount: number }> {
    const userId: string | undefined =
      req.user?.id ?? req.user?.userId ?? req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('No se pudo identificar al usuario.');
    }
    return this.service.toggleLike(userId, anfitrionaId);
  }
}
