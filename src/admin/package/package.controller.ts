import { Controller, Post, Body, Get, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { PackageService } from './package.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { EditPackageDto } from './dto/edit-package.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';


@ApiTags('Packages')
@Controller('packages')
export class PackageController {
  constructor(private readonly packageService: PackageService) {}

  //LISTA TODOS LOS PAQUETES ACTIVOS (público)
  @Get()
  @ApiOperation({ summary: 'Listar todos los paquetes activos' })
  findAll() {
    return this.packageService.findAll();
  }

  //LISTA TODOS LOS PAQUETES INCLUYENDO INACTIVOS (solo ADMIN)
  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar todos los paquetes incluyendo inactivos (admin)' })
  findAllAdmin() {
    return this.packageService.findAllAdmin();
  }

  //OBTENER UN PAQUETE POR SU ID (público)
  @Get(':id')
  @ApiOperation({ summary: 'Obtener un paquete específico por ID' })
  findOne(@Param('id') id: string) {
    return this.packageService.findOne(id);
  }

  //CREAR UN PAQUETE NUEVO (solo ADMIN)
  @Post('create')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear un nuevo paquete de suscripción' })
  create(@Body() createPackageDto: CreatePackageDto) {
    return this.packageService.create(createPackageDto);
  }

  //EDITAR UN PAQUETE EXISTENTE (solo ADMIN)
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Editar un paquete existente' })
  update(@Param('id') id: string, @Body() editPackageDto: EditPackageDto) {
    return this.packageService.update(id, editPackageDto);
  }

  //ELIMINAR UN PAQUETE (solo ADMIN)
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desactivar un paquete (Soft Delete)' })
  remove(@Param('id') id: string) {
    return this.packageService.remove(id);
  }
}
