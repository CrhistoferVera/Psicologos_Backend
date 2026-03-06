import { Controller, Get, Patch, Param, Body, Query, ParseUUIDPipe } from '@nestjs/common';
import { ClientService } from './client.service';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UpdateClientStatusDto } from './dto/update-client-status.dto';

@ApiTags('Admin - Clientes') // Cambiado para organizar mejor tu Swagger
@Controller('admin/clients') // Ruta profesional para el panel de administración
export class ClientController {
  constructor(private readonly clientService: ClientService) { }

  /**
   * LISTAR TODOS LOS CLIENTES (USUARIOS ROL USER)
   */
  @Get()
  @ApiOperation({ summary: 'Listar clientes o buscar por nombre, email o teléfono' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  findAll(
    @Query('search') search?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    return this.clientService.findAll(search, Number(page), Number(limit));
  }

  /**
   * OBTENER DETALLES DE UN CLIENTE ESPECÍFICO
   */
  @Get(':id')
  @ApiOperation({ summary: 'Obtener información detallada de un cliente' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientService.findOne(id);
  }

  /**
   * ACTIVAR O SUSPENDER UN CLIENTE
   */
  @Patch(':id/status')
  @ApiOperation({ summary: 'Cambiar estado del cliente (Activo/Suspendido)' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateClientStatusDto: UpdateClientStatusDto
  ) {
    return this.clientService.updateStatus(id, updateClientStatusDto);
  }
}