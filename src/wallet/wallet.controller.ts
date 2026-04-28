import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { WalletService } from './wallet.service';
import { AddBankAccountDto } from './dto/add-bank-account.dto';
import { CreateWithdrawalRequestDto } from './dto/create-withdrawal-request.dto';

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

  @Get('banks')
  getBanks() {
    return this.walletService.getBanks();
  }

  @Get('me/bank-accounts')
  getBankAccounts(@CurrentUser() user: JwtUser) {
    return this.walletService.getBankAccounts(user.userId);
  }

  @Post('me/bank-accounts')
  addBankAccount(
    @CurrentUser() user: JwtUser,
    @Body() body: AddBankAccountDto,
  ) {
    return this.walletService.addBankAccount(user.userId, body);
  }

  @Delete('me/bank-accounts/:id')
  deleteBankAccount(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.walletService.deleteBankAccount(user.userId, id);
  }

  @Post('me/withdrawal-request')
  createWithdrawalRequest(
    @CurrentUser() user: JwtUser,
    @Body() body: CreateWithdrawalRequestDto,
  ) {
    return this.walletService.createWithdrawalRequest(user.userId, body);
  }

  @Get('me/withdrawal-requests')
  getWithdrawalRequests(@CurrentUser() user: JwtUser) {
    return this.walletService.getWithdrawalRequests(user.userId);
  }
}
