import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  Request,
} from '@nestjs/common';
import { FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UserRole } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProfessionalsService } from './anfitrionas.service';
import { CreateAnfitrioneDto } from './dto/create-anfitriona.dto';
import { UpdateAnfitrioneProfileDto } from './dto/update-anfitriona-profile.dto';
import { PROFESSIONAL_ROLE } from '../common/professional-role';
import { SpecialtyService } from '../admin/specialty/specialty.service';
import { AssignProfessionalSpecialtiesDto } from '../admin/specialty/dto/assign-professional-specialties.dto';

@ApiTags('Professionals - Private')
@Controller(['professionals', 'anfitrionas'])
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProfessionalsController {
  constructor(
    private readonly service: ProfessionalsService,
    private readonly specialtyService: SpecialtyService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('idDoc', { storage: memoryStorage() }))
  create(
    @Body() dto: CreateAnfitrioneDto,
    @UploadedFile() idDoc?: Express.Multer.File,
  ) {
    return this.service.create(dto, idDoc);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.service.findAll();
  }

  @Get('me/profile')
  @Roles(PROFESSIONAL_ROLE)
  getMyProfile(@Request() req) {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?.sub;
    return this.service.getMyProfile(userId);
  }

  @Patch('me/profile')
  @Roles(PROFESSIONAL_ROLE)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'avatar', maxCount: 1 },
        { name: 'cover', maxCount: 1 },
      ],
      { storage: memoryStorage() },
    ),
  )
  updateMyProfile(
    @Request() req,
    @Body() dto: UpdateAnfitrioneProfileDto,
    @UploadedFiles() files?: { avatar?: Express.Multer.File[]; cover?: Express.Multer.File[] },
  ) {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?.sub;
    return this.service.updateMyProfile(
      userId,
      dto,
      files?.avatar?.[0],
      files?.cover?.[0],
    );
  }

  @Get('me/specialties/catalog')
  @Roles(PROFESSIONAL_ROLE)
  getSpecialtyCatalog(@Query('search') search?: string) {
    return this.specialtyService.findAll(false, search);
  }

  @Get('me/specialties')
  @Roles(PROFESSIONAL_ROLE)
  getMySpecialties(@Request() req) {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?.sub;
    return this.specialtyService.getProfessionalSpecialties(userId);
  }

  @Put('me/specialties')
  @Roles(PROFESSIONAL_ROLE)
  updateMySpecialties(
    @Request() req,
    @Body() dto: AssignProfessionalSpecialtiesDto,
  ) {
    const userId = req.user?.id ?? req.user?.userId ?? req.user?.sub;
    return this.specialtyService.assignToProfessional(userId, dto);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
