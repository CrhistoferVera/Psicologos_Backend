import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  Request,
  BadRequestException,
  Delete,
  Query,
  InternalServerErrorException,
} from '@nestjs/common';
import { FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UserRole } from '@prisma/client';
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AnfitrioneService } from './anfitrionas.service';
import { CreateAnfitrioneDto } from './dto/create-anfitriona.dto';
import { CreateHistoryDto } from './dto/create-history.dto';
import { UpdateAnfitrioneProfileDto } from './dto/update-anfitriona-profile.dto';
import { DeleteHistoryDto } from './dto/delete-history.dto';
import { HistoryFeedResponseDto } from './dto/history-feed.dto';
import { CreateGalleryImageDto } from './dto/create-gallery-image.dto';
import { UpdateGalleryImageDto } from './dto/update-gallery-image.dto';
import { GalleryImageDto } from './dto/gallery-image.dto';

@ApiTags('Anfitrionas - Privado')
@Controller('anfitrionas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnfitrioneController {
  constructor(private readonly service: AnfitrioneService) { }

  /**
   * POST /anfitrionas
   * multipart/form-data
   * Campos: firstName, lastName, phoneNumber, dateOfBirth, cedula, username, email (opcional)
   * Archivo: idDoc (imagen o PDF del documento de identidad)
   */
  @Post()
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('idDoc', { storage: memoryStorage() }),
  )
  create(
    @Body() dto: CreateAnfitrioneDto,
    @UploadedFile() idDoc?: Express.Multer.File,
  ) {
    return this.service.create(dto, idDoc);
  }

  /**
   * GET /anfitrionas
   * Lista todas las anfitrionas con su perfil
   */
  @Get()
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.service.findAll();
  }


  // 1. OBTENER EL FEED DE HISTORIAS PARA CLIENTES (Círculos rojos/blancos)
  @Get('feed/stories')
  @Roles(UserRole.USER, UserRole.ADMIN, UserRole.ANFITRIONA) // Todos pueden ver el feed
  async getStoriesFeed(@Request() req): Promise<HistoryFeedResponseDto> {
    const userId = req.user?.id || req.user?.userId || req.user?.sub;

    console.log(`[Feed] Solicitado por Usuario ID: ${userId} - Rol: ${req.user?.role}`);

    return this.service.getStoriesFeed(userId);
  }

  // ─── Own profile ──────────────────────────────────────────────────────────

  /**
   * GET /anfitrionas/me/profile
   * Devuelve el perfil propio de la anfitriona autenticada.
   */
  @Get('me/profile')
  @Roles(UserRole.ANFITRIONA)
  getMyProfile(@Request() req) {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?.sub;
    return this.service.getMyProfile(userId);
  }

  /**
   * PATCH /anfitrionas/me/profile
   * Actualiza el perfil de la anfitriona autenticada.
   * Acepta un avatar opcional via multipart/form-data (campo: avatar).
   */
  @Patch('me/profile')
  @Roles(UserRole.ANFITRIONA)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'avatar', maxCount: 1 },
        { name: 'cover', maxCount: 1 },
      ],
      { storage: memoryStorage() },
    ),
  )
  updateMyProfile(
    @Request() req,
    @Body() dto: UpdateAnfitrioneProfileDto,
    @UploadedFiles() files?: { avatar?: Express.Multer.File[]; cover?: Express.Multer.File[] },
  ) {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?.sub;
    return this.service.updateMyProfile(
      userId,
      dto,
      files?.avatar?.[0],
      files?.cover?.[0],
    );
  }

  //CREAR UNA HISTORIA PARA UNA ANFITRIONA
  @Post('history')
  @Roles(UserRole.ANFITRIONA)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async createStory(
    @Request() req,
    @Body() dto: CreateHistoryDto,
    @UploadedFile() file: Express.Multer.File,
  ) {

    console.log('--- Nueva Petición de Historia ---');
    console.log(`Anfitriona ID: ${req.user?.id}`);
    console.log(`Datos (DTO):`, dto);
    console.log(`Archivo recibido: ${file?.originalname} (${file?.mimetype}) - ${file?.size} bytes`);
    console.log('---------------------------------');

    if (!file) {
      throw new BadRequestException('Debes subir una imagen o video para la historia');
    }

    const userId = req.user?.id || req.user?.userId || req.user?.sub;

    // req.user.id viene del JwtAuthGuard
    return this.service.createHistory(userId, dto, file);
  }

  //ELIMINAR UNA HISTORIA DE UNA ANFITRIONA
  @Delete('history/:id')
  @Roles(UserRole.ANFITRIONA)
  async deleteStory(
    @Request() req,
    @Param('id') historyId: string, // El ID viene de la URL
  ) {

    console.log(`[Delete] Anfitriona ID: ${req.user.id} intentando eliminar historia: ${historyId}`);


    return this.service.deleteHistory(req.user.id, historyId);
  }

  //OBTENER TODAS LAS HISTORIAS DE UNA ANFITRIONA
  @Get('me/stories')
  @Roles(UserRole.ANFITRIONA)
  @UseGuards(JwtAuthGuard, RolesGuard)
  async getMyStories(@Request() req) {

    console.log('Usuario en la petición:', req.user);

    const userId = req.user?.id || req.user?.userId || req.user?.sub;

    return this.service.findAllStories(userId);
  }

  // 2. MARCAR UNA HISTORIA COMO VISTA
  @Post('history/:id/view')
  @Roles(UserRole.USER, UserRole.ANFITRIONA)
  async markAsViewed(
    @Request() req,
    @Param('id') historyId: string
  ) {
    const userId = req.user?.id || req.user?.userId || req.user?.sub;

    console.log('--- Registro de Visualización ---');
    console.log(`Usuario: ${userId}`);
    console.log(`Historia ID: ${historyId}`);
    console.log('---------------------------------');

    return this.service.markAsViewed(userId, historyId);
  }

  // ─── Galería permanente (HU: bloqueo de imágenes premium) ────────────────

  /**
   * POST /anfitrionas/me/gallery
   * Publica una imagen permanente en la galería de la anfitriona autenticada.
   * Acepta multipart/form-data con el archivo en el campo "file".
   */
  @Post('me/gallery')
  @Roles(UserRole.ANFITRIONA)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiOperation({
    summary: 'Publicar imagen en galería permanente',
    description:
      'Sube una imagen a Cloudinary y la registra en la galería permanente del perfil. ' +
      'Si isPremium es true, unlockCredits debe ser mayor a 0.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'isPremium'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'Imagen (jpg, png, webp…)' },
        isPremium: {
          type: 'boolean',
          example: false,
          description: 'true = imagen exclusiva bloqueada por créditos',
        },
        unlockCredits: {
          type: 'integer',
          example: 30,
          description: 'Requerido y > 0 si isPremium es true',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Imagen publicada correctamente',
    type: GalleryImageDto,
    example: {
      id: '550e8400-e29b-41d4-a716-446655440000',
      imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/gallery_1.jpg',
      isPremium: true,
      unlockCredits: 30,
      isVisible: true,
      createdAt: '2026-03-19T10:00:00.000Z',
    },
  })
  @ApiResponse({ status: 400, description: 'Archivo faltante o imagen premium sin créditos válidos' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 404, description: 'Perfil de anfitriona no encontrado' })
  async publishGalleryImage(
    @Request() req,
    @Body() dto: CreateGalleryImageDto,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<GalleryImageDto> {
    if (!file) {
      throw new BadRequestException('Debes subir una imagen para la galería.');
    }
    const userId = req.user?.id ?? req.user?.userId ?? req.user?.sub;
    return this.service.publishGalleryImage(userId, dto, file);
  }

  /**
   * GET /anfitrionas/me/gallery
   * Devuelve la galería completa de la anfitriona autenticada con toda la metadata.
   */
  @Get('me/gallery')
  @Roles(UserRole.ANFITRIONA)
  @ApiOperation({
    summary: 'Obtener galería propia',
    description:
      'Devuelve todas las imágenes de la galería de la anfitriona autenticada ' +
      'incluyendo metadata de gestión (isPremium, unlockCredits, isVisible).',
  })
  @ApiResponse({
    status: 200,
    description: 'Galería de la anfitriona',
    type: [GalleryImageDto],
    example: [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/gallery_1.jpg',
        isPremium: false,
        unlockCredits: null,
        isVisible: true,
        createdAt: '2026-03-19T10:00:00.000Z',
      },
      {
        id: '660e8400-e29b-41d4-a716-446655440111',
        imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/gallery_2.jpg',
        isPremium: true,
        unlockCredits: 30,
        isVisible: true,
        createdAt: '2026-03-19T11:00:00.000Z',
      },
    ],
  })
  @ApiResponse({ status: 404, description: 'Perfil de anfitriona no encontrado' })
  getMyGallery(@Request() req): Promise<GalleryImageDto[]> {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?.sub;
    return this.service.getMyGallery(userId);
  }

  /**
   * POST /anfitrionas/me/gallery/:id/set-featured
   * Marca una imagen como la destacada del feed (sortOrder = 0, resto = 1).
   */
  @Post('me/gallery/:id/set-featured')
  @Roles(UserRole.ANFITRIONA)
  async setFeaturedGalleryImage(
    @Request() req,
    @Param('id') imageId: string,
  ): Promise<GalleryImageDto> {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?.sub;
    return this.service.setFeaturedGalleryImage(userId, imageId);
  }

  /**
   * DELETE /anfitrionas/me/gallery/:id
   * Elimina una imagen de la galería de la anfitriona autenticada.
   * Borra el archivo en Cloudinary y el registro en la BD.
   */
  @Delete('me/gallery/:id')
  @Roles(UserRole.ANFITRIONA)
  @HttpCode(204)
  async deleteMyGalleryImage(
    @Request() req,
    @Param('id') imageId: string,
  ): Promise<void> {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?.sub;
    return this.service.deleteMyGalleryImage(userId, imageId);
  }

  /**
   * PATCH /anfitrionas/me/gallery/:id
   * Actualiza los metadatos de una imagen de la galería (isPremium, unlockCredits, isVisible, sortOrder).
   */
  @Patch('me/gallery/:id')
  @Roles(UserRole.ANFITRIONA)
  async updateMyGalleryImage(
    @Request() req,
    @Param('id') imageId: string,
    @Body() dto: UpdateGalleryImageDto,
  ): Promise<GalleryImageDto> {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?.sub;
    return this.service.updateMyGalleryImage(userId, imageId, dto);
  }

  /**
   * GET /anfitrionas/:id
   * Obtiene una anfitriona por su userId
   */
  @Get(':id')
  @Roles(UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

}

