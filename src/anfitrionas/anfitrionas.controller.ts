import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Request,
  BadRequestException,
  Delete,
  Query,
  InternalServerErrorException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AnfitrioneService } from './anfitrionas.service';
import { CreateAnfitrioneDto } from './dto/create-anfitriona.dto';
import { CreateHistoryDto } from './dto/create-history.dto';
import { UpdateAnfitrioneProfileDto } from './dto/update-anfitriona-profile.dto';
import { DeleteHistoryDto } from './dto/delete-history.dto';
import { HistoryFeedResponseDto } from './dto/history-feed.dto';

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

  /**
   * GET /anfitrionas/:id
   * Obtiene una anfitriona por su userId
   */
  @Get(':id')
  @Roles(UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
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
  @UseInterceptors(FileInterceptor('avatar', { storage: memoryStorage() }))
  updateMyProfile(
    @Request() req,
    @Body() dto: UpdateAnfitrioneProfileDto,
    @UploadedFile() avatar?: Express.Multer.File,
  ) {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?.sub;
    return this.service.updateMyProfile(userId, dto, avatar);
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

  // 1. OBTENER EL FEED DE HISTORIAS PARA CLIENTES (Círculos rojos/blancos)
  @Get('feed/stories')
  @Roles(UserRole.USER, UserRole.ADMIN, UserRole.ANFITRIONA) // Todos pueden ver el feed
  async getStoriesFeed(@Request() req): Promise<HistoryFeedResponseDto> {
    const userId = req.user?.id || req.user?.userId || req.user?.sub;

    console.log(`[Feed] Solicitado por Usuario ID: ${userId} - Rol: ${req.user?.role}`);

    return this.service.getStoriesFeed(userId);
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


}

