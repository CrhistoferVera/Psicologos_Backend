import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ReferralsService } from './referrals.service';
import { AdminReferralsQueryDto } from './dto/admin-referrals-query.dto';
import { UpsertBonusTierDto } from './dto/upsert-bonus-tier.dto';

@ApiTags('Admin - Referrals')
@Controller('admin/referrals')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar programa de referidos para panel admin' })
  list(@Query() query: AdminReferralsQueryDto) {
    return this.referralsService.getAdminReferrals(query);
  }

  @Get('bonus-tiers')
  @ApiOperation({ summary: 'Listar tiers de bono por volumen de referidos' })
  listBonusTiers() {
    return this.referralsService.getAdminBonusTiers();
  }

  @Post('bonus-tiers')
  @ApiOperation({ summary: 'Crear o actualizar un tier de bono (upsert por id)' })
  upsertBonusTier(@Body() dto: UpsertBonusTierDto) {
    return this.referralsService.upsertAdminBonusTier(dto);
  }

  @Delete('bonus-tiers/:id')
  @ApiOperation({ summary: 'Eliminar un tier de bono' })
  deleteBonusTier(@Param('id') id: string) {
    return this.referralsService.deleteAdminBonusTier(id);
  }
}
