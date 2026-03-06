import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AnfitrioneService } from './anfitrionas.service';
import { CreateAnfitrioneDto } from './dto/create-anfitriona.dto';

@Controller('anfitrionas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AnfitrioneController {
  constructor(private readonly service: AnfitrioneService) {}

  /**
   * POST /anfitrionas
   * multipart/form-data
   * Campos: firstName, lastName, phoneNumber, dateOfBirth, cedula, username, email (opcional)
   * Archivo: idDoc (imagen o PDF del documento de identidad)
   */
  @Post()
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
  findAll() {
    return this.service.findAll();
  }

  /**
   * GET /anfitrionas/:id
   * Obtiene una anfitriona por su userId
   */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
