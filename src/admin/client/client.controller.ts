import { Controller, Get, Patch, Param, Body, Query, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ClientService } from './client.service';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UpdateClientStatusDto } from './dto/update-client-status.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Admin - Clientes')
@Controller('admin/clients')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @Get()
  @ApiOperation({ summary: 'Listar clientes con paginacion infinita' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'cursor', required: false, description: 'ID del ultimo registro recibido' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  findAll(
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit: number = 10,
  ) {
    return this.clientService.findAll(search, cursor, Number(limit));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener informacion detallada de un cliente' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientService.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cambiar estado del cliente (Activo/Suspendido)' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateClientStatusDto: UpdateClientStatusDto,
  ) {
    return this.clientService.updateStatus(id, updateClientStatusDto);
  }
}
