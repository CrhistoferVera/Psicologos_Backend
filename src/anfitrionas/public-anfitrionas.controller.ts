import { Controller, Get, Param, ParseUUIDPipe, Query, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { ProfessionalsService } from './anfitrionas.service';
import { ProfessionalPublicListResponseDto } from './dto/professional-public-list.dto';
import { ProfessionalPublicDetailDto } from './dto/professional-public-detail.dto';

@ApiTags('Professionals - Public')
@Controller(['professionals/public', 'anfitrionas/public'])
export class PublicProfessionalsController {
  constructor(private readonly service: ProfessionalsService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Listado publico de profesionales',
    description:
      'Devuelve profesionales activos con perfil completo.',
  })
  @ApiQuery({
    name: 'specialty',
    required: false,
    description: 'Filtro por especialidad (id, slug o texto de nombre).',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de profesionales',
    type: ProfessionalPublicListResponseDto,
  })
  findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('specialty') specialty = '',
    @Request() req: any,
  ): Promise<ProfessionalPublicListResponseDto> {
    const currentUserId: string | undefined =
      req.user?.id ?? req.user?.userId ?? req.user?.sub;

    return this.service.findAllPublic(Number(page), Number(limit), currentUserId, specialty);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Perfil publico de un profesional',
    description: 'Devuelve informacion publica detallada de un profesional activo.',
  })
  @ApiParam({ name: 'id', description: 'UUID del usuario profesional' })
  @ApiResponse({
    status: 200,
    description: 'Perfil del profesional',
    type: ProfessionalPublicDetailDto,
  })
  @ApiResponse({ status: 404, description: 'Profesional no encontrado' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ): Promise<ProfessionalPublicDetailDto> {
    const currentUserId: string | undefined =
      req.user?.id ?? req.user?.userId ?? req.user?.sub;

    return this.service.findOnePublic(id, currentUserId);
  }
}
