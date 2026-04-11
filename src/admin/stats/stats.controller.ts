import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Admin - Stats')
@Controller('admin/stats')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  @ApiOperation({ summary: 'Obtener estadisticas generales del panel admin' })
  getStats() {
    return this.statsService.getStats();
  }

  @Get(['professional/:id', 'anfitriona/:id'])
  @ApiOperation({ summary: 'Obtener ganancias en creditos y soles de un profesional' })
  getProfessionalStats(@Param('id') id: string) {
    return this.statsService.getProfessionalStats(id);
  }
}

