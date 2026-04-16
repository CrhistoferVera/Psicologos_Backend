import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SpecialtyService } from './specialty.service';

@ApiTags('Specialties - Public')
@Controller('specialties')
export class PublicSpecialtyController {
  constructor(private readonly specialtyService: SpecialtyService) {}

  @Get('public')
  @ApiOperation({ summary: 'Catalogo publico de especialidades activas' })
  findPublic(@Query('search') search?: string) {
    return this.specialtyService.findAll(false, search);
  }
}
