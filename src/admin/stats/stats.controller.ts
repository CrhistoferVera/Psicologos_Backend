import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';

@ApiTags('Admin - Stats')
@Controller('admin/stats')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  @ApiOperation({ summary: 'Obtener estadísticas generales del panel admin' })
  getStats() {
    return this.statsService.getStats();
  }

  @Get('anfitriona/:id')
  @ApiOperation({ summary: 'Obtener ganancias en créditos y soles de una anfitriona' })
  getAnfitrionaStats(@Param('id') id: string) {
    return this.statsService.getAnfitrionaStats(id);
  }
}
