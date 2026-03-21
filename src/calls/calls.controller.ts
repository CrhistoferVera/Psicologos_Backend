import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CallsService } from './calls.service';

@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  // POST /calls/token — genera token Agora RTC para unirse a un canal
  @Post('token')
  getToken(@Body() body: { channelName: string; uid: number }) {
    return this.callsService.generateToken(body.channelName, body.uid ?? 0);
  }
}
