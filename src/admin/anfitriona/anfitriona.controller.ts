import { Controller, Get, Patch, Param, Body, Query, ParseUUIDPipe } from '@nestjs/common';
import { AnfitrionaService } from './anfitriona.service';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UpdateAnfitrionaDto } from './dto/update-anfitriona.dto';

@ApiTags('Admin - Anfitrionas') // Cambiado para organizar mejor tu Swagger
@Controller('admin/anfitrionas') // Ruta profesional para el panel de administración
export class AnfitrionaController {
  constructor(private readonly clientService: AnfitrionaService) { }

  /**
   * LISTAR TODOS LAS ANFITRIONA (USUARIOS ROL ANFITRIONA)
   */
  @Get()
  @ApiOperation({ summary: 'Listar anfitrionas o buscar por nombre, email o teléfono' })
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
   * OBTENER DETALLES DE UN ANFITRIONA ESPECÍFICO
   */
  @Get(':id')
  @ApiOperation({ summary: 'Obtener información detallada de una anfitriona' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.clientService.findOne(id);
  }

  /**
   * ACTIVAR O SUSPENDER UNA ANFITRIONA
   */
  @Patch(':id/status')
  @ApiOperation({ summary: 'Cambiar estado de la anfitriona (Activo/Suspendido)' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateAnfitrionaStatusDto: UpdateAnfitrionaDto
  ) {
    return this.clientService.updateStatus(id, updateAnfitrionaStatusDto);
  }
}