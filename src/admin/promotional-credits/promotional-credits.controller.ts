import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';
import { PromotionalCreditsService } from './promotional-credits.service';
import { GrantPromotionalCreditsDto } from './dto/grant-promotional-credits.dto';

interface JwtUser {
  userId: string;
}

@ApiTags('Admin - Promotional Credits')
@Controller('admin/promotional-credits')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PromotionalCreditsController {
  constructor(private readonly promotionalCreditsService: PromotionalCreditsService) {}

  @Post('grants')
  @ApiOperation({ summary: 'Otorgar créditos promocionales a un usuario' })
  grantCredits(
    @CurrentUser() admin: JwtUser,
    @Body() dto: GrantPromotionalCreditsDto,
  ) {
    return this.promotionalCreditsService.grantCredits(admin.userId, dto);
  }

  @Get('grants')
  @ApiOperation({ summary: 'Listar historial de créditos promocionales otorgados' })
  listGrants(
    @Query('limit') limit = '50',
    @Query('recipientUserId') recipientUserId?: string,
  ) {
    return this.promotionalCreditsService.listGrants(Number(limit), recipientUserId);
  }
}
