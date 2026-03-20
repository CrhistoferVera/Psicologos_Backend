import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { WalletService } from './wallet.service';

interface JwtUser {
  userId: string;
  role: string;
}

@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get('me/earnings')
  getMyEarnings(@CurrentUser() user: JwtUser) {
    return this.walletService.getMyEarnings(user.userId);
  }
}
