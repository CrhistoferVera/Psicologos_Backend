import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { SystemConfigService } from '../../system-config/system-config.service';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';

@ApiTags('Admin - Config')
@Controller('admin/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminConfigController {
  constructor(private readonly systemConfigService: SystemConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Obtener configuración global persistente del sistema' })
  getConfig() {
    return this.systemConfigService.getRuntimeConfig();
  }

  @Patch()
  @ApiOperation({ summary: 'Actualizar configuración global persistente del sistema' })
  updateConfig(@Body() dto: UpdateSystemConfigDto) {
    return this.systemConfigService.updateConfig(dto);
  }
}
