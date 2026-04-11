import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { SpecialtyService } from './specialty.service';
import { CreateSpecialtyDto } from './dto/create-specialty.dto';
import { UpdateSpecialtyDto } from './dto/update-specialty.dto';
import { AssignProfessionalSpecialtiesDto } from './dto/assign-professional-specialties.dto';

@ApiTags('Admin - Specialties')
@Controller('admin/specialties')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class SpecialtyController {
  constructor(private readonly specialtyService: SpecialtyService) {}

  @Get()
  @ApiOperation({ summary: 'Listar especialidades' })
  findAll(
    @Query('includeInactive') includeInactive = 'false',
    @Query('search') search?: string,
  ) {
    return this.specialtyService.findAll(includeInactive === 'true', search);
  }

  @Post()
  @ApiOperation({ summary: 'Crear especialidad' })
  create(@Body() dto: CreateSpecialtyDto) {
    return this.specialtyService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar especialidad' })
  update(@Param('id') id: string, @Body() dto: UpdateSpecialtyDto) {
    return this.specialtyService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Desactivar especialidad' })
  deactivate(@Param('id') id: string) {
    return this.specialtyService.deactivate(id);
  }

  @Put('professionals/:userId')
  @ApiOperation({ summary: 'Asignar especialidades a un profesional' })
  assignToProfessional(
    @Param('userId') userId: string,
    @Body() dto: AssignProfessionalSpecialtiesDto,
  ) {
    return this.specialtyService.assignToProfessional(userId, dto);
  }

  @Get('professionals/:userId')
  @ApiOperation({ summary: 'Listar especialidades de un profesional' })
  getProfessionalSpecialties(@Param('userId') userId: string) {
    return this.specialtyService.getProfessionalSpecialties(userId);
  }
}
