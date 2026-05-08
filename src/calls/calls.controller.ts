import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CallsService } from './calls.service';

interface JwtUser {
  userId: string;
}

@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Post('token')
  getToken(
    @CurrentUser() user: JwtUser,
    @Body() body: { channelName: string; uid: number; otherUserId: string },
  ) {
    return this.callsService.generateTokenForCall(
      user.userId,
      body.otherUserId,
      body.channelName,
      body.uid ?? 0,
    );
  }
}
