import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UpdateAnfitrionaDto, EditAnfitrionaDto } from './dto/update-anfitriona.dto';
import { UpdateAnfitrionaProfileDto } from './dto/update-anfitriona-profile.dto';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '@prisma/client';
import { AdminProfessionalsService } from './anfitriona.service';

@ApiTags('Admin - Professionals')
@Controller('admin/professionals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminProfessionalsController {
  constructor(private readonly professionalsService: AdminProfessionalsService) {}

  @Get('list/withdrawal-requests')
  @ApiOperation({ summary: 'Listar solicitudes de retiro de profesionales' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'cursor', required: false, description: 'ID del ultimo registro recibido' })
  findAllWithdrawalRequests(
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = 10,
  ) {
    return this.professionalsService.findAllWithdrawalRequest(
      search,
      cursor,
      Number(limit),
    );
  }

  @Get('payment/history')
  @ApiOperation({ summary: 'Historial de pagos a profesionales' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'cursor', required: false, description: 'ID del ultimo registro recibido' })
  findWithdrawalRequestHistory(
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = 10,
  ) {
    return this.professionalsService.findWithdrawalRequestHistory(
      search,
      cursor,
      Number(limit),
    );
  }

  @Get('count/pending-withdrawal-requests')
  @ApiOperation({ summary: 'Obtener cantidad de solicitudes de retiro pendientes' })
  countPendingWithdrawalRequests() {
    return this.professionalsService.countPendingRequests();
  }

  @Get()
  @ApiOperation({ summary: 'Listar profesionales o buscar por nombre, email o telefono' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'cursor', required: false, description: 'ID del ultimo registro recibido' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  findAll(
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = 10,
  ) {
    return this.professionalsService.findAll(
      search,
      cursor,
      Number(limit),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener informacion detallada de un profesional' })
  findOne(@Param('id') id: string) {
    return this.professionalsService.findOne(id);
  }

  @Patch(':id/edit')
  @ApiOperation({ summary: 'Editar telefono, username, bio, rateCredits o email de un profesional' })
  editProfessional(@Param('id') id: string, @Body() dto: EditAnfitrionaDto) {
    return this.professionalsService.editProfessional(id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cambiar estado del profesional (Activo/Suspendido)' })
  updateStatus(@Param('id') id: string, @Body() updateStatusDto: UpdateAnfitrionaDto) {
    return this.professionalsService.updateStatus(id, updateStatusDto);
  }

  @Patch(':id/profile')
  @ApiOperation({ summary: 'Editar datos de perfil de un profesional' })
  updateProfile(@Param('id') id: string, @Body() dto: UpdateAnfitrionaProfileDto) {
    return this.professionalsService.updateProfile(id, dto);
  }
}

