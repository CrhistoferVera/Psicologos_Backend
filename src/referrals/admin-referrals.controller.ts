import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ReferralsService } from './referrals.service';
import { AdminReferralsQueryDto } from './dto/admin-referrals-query.dto';

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
}
