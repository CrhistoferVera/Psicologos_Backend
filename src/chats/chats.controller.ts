import { Controller, Get, Query } from '@nestjs/common';
import { ChatsService } from './chats.service';

@Controller('agora')
export class ChatsController {
  constructor(private readonly agoraService: ChatsService) {}

  @Get('token')
  getToken(
    @Query('channel') channel: string,
    @Query('uid') uid: number,
  ) {
    const token = this.agoraService.generateRtcToken(channel, Number(uid));

    return {
      token,
      channel,
      uid,
    };
  }
}