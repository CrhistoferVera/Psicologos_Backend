import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ReferralsService } from './referrals.service';

interface JwtUser {
  userId: string;
}

@ApiTags('Referrals')
@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Obtener resumen de referidos del usuario autenticado' })
  getMyReferrals(@CurrentUser() user: JwtUser) {
    return this.referralsService.getMyReferrals(user.userId);
  }
}
