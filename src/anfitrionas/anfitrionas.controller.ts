import {
  Body,
  Controller,
  Get,
  Param,
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
import { DeleteHistoryDto } from './dto/delete-history.dto';

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

  //CREAR UNA HISTORIA PARA UNA ANFITRIONA
  @Post('history')
  @Roles(UserRole.ANFITRIONA) // Solo la anfitriona puede subir sus historias
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async createStory(
    @Request() req,
    @Body() dto: CreateHistoryDto,
    @UploadedFile() file: Express.Multer.File,
  ) {

    if (!file) {
      throw new BadRequestException('Debes subir una imagen o video para la historia');
    }

    // req.user.id viene del JwtAuthGuard
    return this.service.createHistory(req.user.id, dto, file);
  }

  //ELIMINAR UNA HISTORIA DE UNA ANFITRIONA
  @Delete('history/:id')
  @Roles(UserRole.ANFITRIONA)
  async deleteStory(
    @Request() req,
    @Param('id') historyId: string, // El ID viene de la URL
  ) {
    
    return this.service.deleteHistory(req.user.id, historyId);
  }

}
